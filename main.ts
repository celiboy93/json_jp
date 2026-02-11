// main.ts
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";

const kv = await Deno.openKv();
const PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "admin123"; 
const COOKIE_NAME = "admin_session";

// 1. Database Helper Functions
async function getConfig() {
  // ကုဒ်ထဲမှာ ဘာမှ ကြိုရေးမထားပါ၊ KV Database ထဲကပဲ ဆွဲထုတ်ပါမယ်
  const adminUrl = await kv.get(["config", "AdminUrl"]);
  const marquee = await kv.get(["config", "Marquee"]);
  
  return {
    // Data မရှိသေးရင် အလွတ် (String အလွတ်) ပဲ ပို့ပေးပါမယ်
    AdminUrl: adminUrl.value || "",
    Marquee: marquee.value || "",
  };
}

async function getUsers() {
  const users = [];
  const iter = kv.list({ prefix: ["users"] });
  for await (const res of iter) {
    users.push(res.value);
  }
  return users;
}

async function getFullJson() {
  const config = await getConfig();
  const users = await getUsers();
  return {
    ...config,
    Users: users,
  };
}

// 2. HTML Templates
function html(body: string) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Control Panel</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 p-4">
      <div class="max-w-3xl mx-auto bg-white p-6 rounded shadow">
        ${body}
      </div>
    </body>
    </html>
  `;
}

// 3. Request Handler
serve(async (req) => {
  const url = new URL(req.url);
  const cookie = req.headers.get("cookie");
  const isLoggedIn = cookie?.includes(`${COOKIE_NAME}=logged_in`);

  // --- PUBLIC API (Raw JSON) ---
  if (url.pathname === "/raw" || url.pathname === "/config.json") {
    const data = await getFullJson();
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 
        "content-type": "application/json",
        "Access-Control-Allow-Origin": "*" // App ကနေလှမ်းခေါ်ရင် Block မခံရအောင်
      },
    });
  }

  // --- LOGIN PAGE ---
  if (!isLoggedIn && url.pathname !== "/login") {
    return new Response(html(`
      <h1 class="text-2xl font-bold mb-4 text-center">Login Required</h1>
      <form action="/login" method="POST" class="space-y-4 max-w-sm mx-auto">
        <input type="password" name="password" placeholder="Enter Admin Password" class="border p-2 w-full rounded" required>
        <button type="submit" class="bg-blue-600 text-white px-4 py-2 w-full rounded hover:bg-blue-700">Login</button>
      </form>
    `), { headers: { "content-type": "text/html" } });
  }

  // --- HANDLE LOGIN ---
  if (url.pathname === "/login" && req.method === "POST") {
    const form = await req.formData();
    const pass = form.get("password");
    if (pass === PASSWORD) {
      const headers = new Headers();
      headers.set("Set-Cookie", `${COOKIE_NAME}=logged_in; HttpOnly; Path=/; Max-Age=86400`);
      headers.set("Location", "/");
      return new Response(null, { status: 302, headers });
    } else {
      return new Response("Wrong Password", { status: 403 });
    }
  }

  // --- ACTIONS (Add/Edit/Delete) ---
  if (req.method === "POST") {
    const form = await req.formData();
    const action = form.get("action");

    if (action === "update_config") {
      // ဒီနေရာမှာ Web ကနေ ပို့လိုက်တဲ့ Data ကို Database ထဲသိမ်းပါမယ်
      await kv.set(["config", "AdminUrl"], form.get("AdminUrl"));
      await kv.set(["config", "Marquee"], form.get("Marquee"));
    } 
    
    else if (action === "add_user") {
      const id = form.get("ID") as string;
      const dateInput = form.get("Expiry") as string; 
      // Convert YYYY-MM-DD to DD/MM/YYYY
      let expiry = dateInput;
      if(dateInput.includes("-")){
          const [y, m, d] = dateInput.split("-");
          expiry = `${d}/${m}/${y}`;
      }
      
      await kv.set(["users", id], { ID: id, Expiry: expiry });
    } 
    
    else if (action === "delete_user") {
      const id = form.get("ID") as string;
      await kv.delete(["users", id]);
    }

    return Response.redirect(url.origin);
  }

  // --- DASHBOARD (Main UI) ---
  const config = await getConfig();
  const users = await getUsers();

  const userRows = users.map(u => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-3 font-mono text-sm">${u.ID}</td>
      <td class="p-3">${u.Expiry}</td>
      <td class="p-3 text-right">
        <div class="flex justify-end gap-2">
           <!-- Edit Button (Loads data into form - simple JS trick) -->
           <button onclick="editUser('${u.ID}', '${u.Expiry}')" class="text-blue-500 hover:text-blue-700 text-sm">Edit</button>
           
           <form method="POST" class="inline" onsubmit="return confirm('Are you sure?');">
            <input type="hidden" name="action" value="delete_user">
            <input type="hidden" name="ID" value="${u.ID}">
            <button class="text-red-500 hover:text-red-700 text-sm">Delete</button>
          </form>
        </div>
      </td>
    </tr>
  `).join("");

  return new Response(html(`
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold text-gray-800">Setting & Users</h1>
      <div class="text-sm">
        <a href="/raw" target="_blank" class="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300">Check JSON</a>
      </div>
    </div>

    <!-- Config Form -->
    <div class="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-8">
      <h2 class="font-bold mb-4 text-lg border-b pb-2">Main Configuration</h2>
      <p class="text-sm text-gray-500 mb-4">ဒီအကွက်တွေမှာ ဖြည့်ထားတာတွေက App ထဲမှာ ပေါ်နေမှာပါ။</p>
      <form method="POST" class="grid gap-4">
        <input type="hidden" name="action" value="update_config">
        <div>
          <label class="block text-sm font-semibold mb-1">Admin Contact URL (Telegram/Link)</label>
          <input type="text" name="AdminUrl" value="${config.AdminUrl}" placeholder="Example: https://t.me/yourname" class="border p-2 w-full rounded focus:ring focus:ring-blue-200 outline-none">
        </div>
        <div>
          <label class="block text-sm font-semibold mb-1">Marquee Text (Announcement)</label>
          <input type="text" name="Marquee" value="${config.Marquee}" placeholder="Example: Contact admin for VIP..." class="border p-2 w-full rounded focus:ring focus:ring-blue-200 outline-none">
        </div>
        <button class="bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 w-fit">Update Settings</button>
      </form>
    </div>

    <!-- Add User Form -->
    <div class="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-8">
      <h2 class="font-bold mb-4 text-lg border-b pb-2">User Management</h2>
      <form method="POST" class="flex flex-col md:flex-row gap-3 items-end" id="userForm">
        <input type="hidden" name="action" value="add_user">
        <div class="flex-1 w-full">
          <label class="block text-sm font-semibold mb-1">User ID / Device ID</label>
          <input type="text" name="ID" id="inputID" placeholder="Enter ID" class="border p-2 w-full rounded" required>
        </div>
        <div class="w-full md:w-auto">
          <label class="block text-sm font-semibold mb-1">Expiry Date</label>
          <input type="date" name="Expiry" id="inputDate" class="border p-2 w-full rounded" required>
        </div>
        <button class="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 w-full md:w-auto">Save User</button>
      </form>
    </div>

    <!-- Users List -->
    <h2 class="font-bold mb-3 text-lg">Active Users List (${users.length})</h2>
    <div class="overflow-x-auto border rounded-lg">
      <table class="w-full text-left bg-white">
        <thead class="bg-gray-100 text-gray-600 uppercase text-xs">
          <tr>
            <th class="p-3">ID</th>
            <th class="p-3">Expiry</th>
            <th class="p-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${userRows.length > 0 ? userRows : '<tr><td colspan="3" class="p-4 text-center text-gray-500">No users found.</td></tr>'}
        </tbody>
      </table>
    </div>

    <script>
      // Simple script to fill the form for editing
      function editUser(id, expiryStr) {
        document.getElementById('inputID').value = id;
        
        // Convert DD/MM/YYYY back to YYYY-MM-DD for input type="date"
        const parts = expiryStr.split('/');
        if(parts.length === 3) {
           const isoDate = parts[2] + '-' + parts[1] + '-' + parts[0];
           document.getElementById('inputDate').value = isoDate;
        }
        
        window.scrollTo(0, document.getElementById('userForm').offsetTop);
      }
    </script>
  `), { headers: { "content-type": "text/html" } });
});
