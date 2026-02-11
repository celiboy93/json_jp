import { serve } from "https://deno.land/std@0.220.0/http/server.ts";

const kv = await Deno.openKv();

// --- CONFIGURATION ---
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "admin123";
const COOKIE_NAME = "admin_session";

// 1. Helper Functions

// Data အရှည်ကြီးတွေကို ပြန်ဆက်ပေးတဲ့ Function
async function getVpnData() {
  const countRes = await kv.get(["config", "VpnData_Count"]);
  const count = countRes.value || 0;

  if (!count) {
    const old = await kv.get(["config", "VpnData"]);
    return old.value || "";
  }

  let fullString = "";
  for (let i = 0; i < count; i++) {
    const chunk = await kv.get(["config", "VpnData_Chunk", i]);
    fullString += (chunk.value || "");
  }
  return fullString;
}

// Data အရှည်ကြီးတွေကို အပိုင်းသေးသေးလေးတွေ (8000 စာလုံးစီ) ဖြတ်သိမ်းမယ့် Function
async function saveVpnData(longString: string) {
  // အရင် Data အဟောင်းတွေကို အရင်ဖျက်မယ် (Clean up)
  const oldCount = await kv.get(["config", "VpnData_Count"]);
  if (oldCount.value) {
    for (let i = 0; i < (oldCount.value as number); i++) {
        await kv.delete(["config", "VpnData_Chunk", i]);
    }
  }

  // Safe limit for special characters is around 8000-10000 chars
  const CHUNK_SIZE = 8000; 
  const chunks = [];
  
  for (let i = 0; i < longString.length; i += CHUNK_SIZE) {
    chunks.push(longString.slice(i, i + CHUNK_SIZE));
  }

  // Save Count
  await kv.set(["config", "VpnData_Count"], chunks.length);

  // Save Chunks one by one
  for (let i = 0; i < chunks.length; i++) {
    await kv.set(["config", "VpnData_Chunk", i], chunks[i]);
  }
}

async function getUserData() {
  const adminUrl = await kv.get(["config", "AdminUrl"]);
  const marquee = await kv.get(["config", "Marquee"]);
  
  const users = [];
  const iter = kv.list({ prefix: ["users"] });
  for await (const res of iter) {
    users.push(res.value);
  }

  return {
    AdminUrl: adminUrl.value || "",
    Marquee: marquee.value || "",
    Users: users,
  };
}

function getFutureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

// 2. HTML Templates
function html(title: string, body: string) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 min-h-screen flex flex-col font-sans">
      <div class="flex-grow p-4">
        <div class="max-w-6xl mx-auto bg-white p-6 rounded shadow-lg mt-5">
          ${body}
        </div>
      </div>
      <footer class="text-center p-4 text-gray-500 text-sm">System Powered by Deno KV</footer>
    </body>
    </html>
  `;
}

// 3. Request Handler
serve(async (req) => {
  const url = new URL(req.url);
  const cookie = req.headers.get("cookie");
  const isLoggedIn = cookie?.includes(`${COOKIE_NAME}=logged_in`);
  const userAgent = req.headers.get("user-agent") || "";

  // Browser Filtering Logic
  const isBrowser = 
    userAgent.includes("Mozilla") || 
    userAgent.includes("Chrome") || 
    userAgent.includes("Safari") ||
    req.headers.has("sec-fetch-dest");

  // --- LINK 1: USER AUTH DATA (/raw) ---
  if (url.pathname === "/raw") {
    if (isBrowser && !isLoggedIn) {
      return new Response(JSON.stringify({ message: "Access Denied" }), { status: 403 });
    }
    const data = await getUserData();
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  // --- LINK 2: VPN SERVER DATA (/vpn) ---
  if (url.pathname === "/vpn") {
    // Uncomment next 3 lines if you want to block browser
    // if (isBrowser && !isLoggedIn) {
    //   return new Response("Access Denied", { status: 403 });
    // }
    
    const vpnData = await getVpnData();
    return new Response(vpnData, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // --- TRIAL PAGE ---
  if (url.pathname === "/trial") {
    if (req.method === "POST") {
      const form = await req.formData();
      const id = form.get("id") as string;
      if (!id) return new Response("Invalid ID", { status: 400 });

      const history = await kv.get(["trial_history", id]);
      if (history.value) {
        return new Response(html("Failed", `
          <div class="text-center text-red-600">
            <h1 class="text-2xl font-bold mb-2">Used!</h1>
            <p>Device ID <b>${id}</b> has already used the trial.</p>
            <a href="/trial" class="block mt-4 text-blue-500 underline">Back</a>
          </div>
        `), { headers: { "content-type": "text/html" } });
      }

      const expiryDate = getFutureDate(3);
      await kv.set(["users", id], { ID: id, Expiry: expiryDate });
      await kv.set(["trial_history", id], true);

      return new Response(html("Success", `
        <div class="text-center text-green-600">
          <h1 class="text-2xl font-bold mb-2">Success!</h1>
          <p>Trial Activated for: <b>${id}</b></p>
          <p class="mt-2 text-gray-700">Expires: <b>${expiryDate}</b></p>
        </div>
      `), { headers: { "content-type": "text/html" } });
    }
    return new Response(html("Free VIP Trial", `
      <h1 class="text-2xl font-bold mb-4 text-center text-purple-700">3 Days VIP Trial</h1>
      <form method="POST" class="max-w-sm mx-auto space-y-4">
        <input type="text" name="id" placeholder="Enter Device ID" class="border p-3 w-full rounded outline-none ring-1 ring-purple-300" required>
        <button class="bg-purple-600 text-white w-full py-3 rounded font-bold hover:bg-purple-700">Activate Now</button>
      </form>
    `), { headers: { "content-type": "text/html" } });
  }

  // --- ADMIN LOGIN ---
  if (!isLoggedIn && url.pathname !== "/login") {
    return new Response(html("Admin Panel", `
      <form action="/login" method="POST" class="space-y-4 max-w-sm mx-auto mt-10">
        <h1 class="text-xl font-bold text-center mb-4">Admin Login</h1>
        <input type="password" name="password" placeholder="Password" class="border p-2 w-full rounded" required>
        <button type="submit" class="bg-blue-600 text-white px-4 py-2 w-full rounded hover:bg-blue-700">Login</button>
      </form>
    `), { headers: { "content-type": "text/html" } });
  }

  if (url.pathname === "/login" && req.method === "POST") {
    const form = await req.formData();
    if (form.get("password") === ADMIN_PASSWORD) {
      const headers = new Headers();
      headers.set("Set-Cookie", `${COOKIE_NAME}=logged_in; HttpOnly; Path=/; Max-Age=86400`);
      headers.set("Location", "/");
      return new Response(null, { status: 302, headers });
    }
    return new Response("Wrong Password", { status: 403 });
  }

  // --- ADMIN ACTIONS ---
  if (req.method === "POST") {
    try {
      const form = await req.formData();
      const action = form.get("action");

      if (action === "update_config") {
        await kv.set(["config", "AdminUrl"], form.get("AdminUrl"));
        await kv.set(["config", "Marquee"], form.get("Marquee"));
      } 
      else if (action === "update_vpn") {
        const vpnString = form.get("VpnData") as string;
        await saveVpnData(vpnString);
      }
      else if (action === "add_user") {
        const id = form.get("ID") as string;
        let expiry = form.get("Expiry") as string;
        if(expiry.includes("-")) { const [y, m, d] = expiry.split("-"); expiry = `${d}/${m}/${y}`; }
        await kv.set(["users", id], { ID: id, Expiry: expiry });
      } 
      else if (action === "delete_user") {
        await kv.delete(["users", form.get("ID") as string]);
      } 
      else if (action === "reset_trial") {
        await kv.delete(["trial_history", form.get("ID") as string]);
      }
      return Response.redirect(url.origin);
    } catch (e) {
      // Error Handling Display
      return new Response(html("Error", `
        <div class="text-red-600 p-4 border border-red-400 bg-red-50 rounded">
          <h1 class="font-bold text-lg">System Error</h1>
          <p>${e.message}</p>
          <a href="/" class="underline mt-4 block">Go Back</a>
        </div>
      `), { headers: {"content-type": "text/html"} });
    }
  }

  // --- ADMIN DASHBOARD ---
  const userData = await getUserData();
  const vpnData = await getVpnData();
  
  const userRows = userData.Users.map(u => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2 font-mono text-sm">${u.ID}</td>
      <td class="p-2">${u.Expiry}</td>
      <td class="p-2 text-right">
        <form method="POST" class="inline" onsubmit="return confirm('Reset trial?');">
          <input type="hidden" name="action" value="reset_trial"><input type="hidden" name="ID" value="${u.ID}">
          <button class="text-yellow-600 text-xs mr-2 font-bold">Reset</button>
        </form>
        <form method="POST" class="inline" onsubmit="return confirm('Delete?');">
          <input type="hidden" name="action" value="delete_user"><input type="hidden" name="ID" value="${u.ID}">
          <button class="text-red-500 text-sm font-bold">Del</button>
        </form>
      </td>
    </tr>
  `).join("");

  return new Response(html("Admin Control Panel", `
    <div class="flex justify-between items-center mb-6 border-b pb-4">
      <h1 class="text-2xl font-bold text-gray-800">Admin Control</h1>
      <div class="space-x-3 text-sm font-semibold">
        <a href="/trial" target="_blank" class="text-purple-600 hover:underline">Trial Page</a>
        <span class="text-gray-300">|</span>
        <a href="/raw" target="_blank" class="text-blue-600 hover:underline">User JSON</a>
        <span class="text-gray-300">|</span>
        <a href="/vpn" target="_blank" class="text-green-600 hover:underline">VPN Data</a>
      </div>
    </div>

    <div class="grid lg:grid-cols-2 gap-8 mb-6">
      
      <!-- LEFT COLUMN -->
      <div class="space-y-6">
        <div class="bg-white p-5 rounded border shadow-sm">
          <h3 class="font-bold border-b pb-2 mb-3 text-blue-800">1. App Settings</h3>
          <form method="POST" class="grid gap-4">
            <input type="hidden" name="action" value="update_config">
            <div>
              <label class="block text-xs font-bold mb-1 text-gray-500">Admin Contact URL</label>
              <input type="text" name="AdminUrl" value="${userData.AdminUrl}" class="border p-2 rounded w-full bg-gray-50">
            </div>
            <div>
              <label class="block text-xs font-bold mb-1 text-gray-500">Marquee Text</label>
              <input type="text" name="Marquee" value="${userData.Marquee}" class="border p-2 rounded w-full bg-gray-50">
            </div>
            <button class="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700 w-fit">Save Config</button>
          </form>
        </div>

        <div class="bg-white p-5 rounded border shadow-sm">
          <h3 class="font-bold border-b pb-2 mb-3 text-blue-800">2. Add VIP User</h3>
          <form method="POST" class="flex gap-2 items-end">
            <input type="hidden" name="action" value="add_user">
            <div class="flex-grow">
               <label class="block text-xs font-bold mb-1">ID</label>
               <input type="text" name="ID" placeholder="Device ID" class="border p-2 rounded w-full" required>
            </div>
            <div>
               <label class="block text-xs font-bold mb-1">Expiry</label>
               <input type="date" name="Expiry" class="border p-2 rounded w-full" required>
            </div>
            <button class="bg-blue-600 text-white px-4 py-2 rounded text-sm h-[42px]">Add</button>
          </form>
        </div>

        <div class="bg-white border rounded shadow-sm">
          <div class="p-3 bg-gray-100 font-bold text-sm border-b">Active Users (${userData.Users.length})</div>
          <div class="max-h-[300px] overflow-y-auto">
            <table class="w-full text-left">
              <thead class="bg-gray-50 sticky top-0">
                <tr><th class="p-2 text-xs text-gray-500">ID</th><th class="p-2 text-xs text-gray-500">Expiry</th><th class="p-2 text-right"></th></tr>
              </thead>
              <tbody>
                ${userRows.length > 0 ? userRows : '<tr><td colspan="3" class="p-4 text-center text-gray-400 text-sm">No users yet.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- RIGHT COLUMN: VPN DATA -->
      <div class="space-y-6">
        <div class="bg-white p-5 rounded border shadow-sm h-full flex flex-col">
          <h3 class="font-bold border-b pb-2 mb-3 text-green-700 flex justify-between items-center">
            3. VPN Server Config
            <span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-normal">Heavy Data Mode</span>
          </h3>
          <p class="text-xs text-gray-500 mb-2">Safe to paste large block characters. Data is auto-split to prevent errors.</p>
          
          <form method="POST" class="flex-grow flex flex-col">
            <input type="hidden" name="action" value="update_vpn">
            <textarea name="VpnData" class="flex-grow w-full border p-3 rounded font-mono text-[10px] bg-slate-900 text-green-400 focus:ring-2 ring-green-500 outline-none mb-4 min-h-[400px] whitespace-pre" placeholder="Paste config here...">${vpnData}</textarea>
            <div class="text-right">
              <button class="bg-green-600 text-white py-2 px-6 rounded hover:bg-green-700">Save VPN Data</button>
            </div>
          </form>
        </div>
      </div>

    </div>
  `), { headers: { "content-type": "text/html" } });
});
