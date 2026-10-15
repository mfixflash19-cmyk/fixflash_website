const services = [
  {id:"phone-software",icon:"▣",tone:"phone",name:"Phone Software",desc:"Flash, repair, unlock and more for all brands.",price:20000},
  {id:"server-services",icon:"▤",tone:"server",name:"Server Services",desc:"Global server solutions for various needs.",price:35000},
  {id:"tool-services",icon:"⚒",tone:"tool",name:"Tool Services",desc:"Professional tools and licenses for technicians.",price:50000},
  {id:"remote-services",icon:"☁",tone:"remote",name:"Remote Services",desc:"Fast and secure remote support anywhere.",price:40000}
];
const $ = id => document.getElementById(id);
const money = n => Number(n||0).toLocaleString("en-US",{maximumFractionDigits:2});
let sb=null, session=null, profile=null, orders=[], deposits=[], balance=0;
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600)}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function configured(){return sb!==null}
function requireLogin(){if(!session){toast("Please Login or Register first.");return false}return true}
function renderServices(){
  $("serviceGrid").innerHTML=services.map(s=>`<article class="service-card"><div class="service-icon ${s.tone}">${s.icon}</div><h3>${s.name}</h3><p>${s.desc}</p><div class="service-bottom"><span class="price">${money(s.price)} <small>MMK • starting price</small></span><button class="round-arrow" aria-label="Place order for ${s.name}" data-order="${s.id}">→</button></div></article>`).join("");
  document.querySelectorAll("[data-order]").forEach(b=>b.addEventListener("click",()=>placeOrder(b.dataset.order)));
}
async function refresh(){
 if(!session){orders=[];deposits=[];balance=0;profile=null;render();return}
 const [p,o,d]=await Promise.all([
  sb.from("profiles").select("display_name,role,balance_mmk").eq("id",session.user.id).maybeSingle(),
  sb.from("orders").select("id,service_name,details,price_mmk,status,created_at").order("created_at",{ascending:false}),
  sb.from("deposit_requests").select("id,network,amount_usdt,txid,status,credited_mmk,created_at").order("created_at",{ascending:false})
 ]);
 if(p.error) console.error(p.error); if(o.error) console.error(o.error); if(d.error) console.error(d.error);
 profile=p.data||null; orders=o.data||[]; deposits=d.data||[]; balance=Number(profile?.balance_mmk||0);render();
 if(profile?.role==="admin") loadAdmin();
}
function render(){
 $("heroBalance").textContent=money(balance);$("heroOrders").textContent=orders.length;$("heroDeposits").textContent=deposits.filter(d=>d.status==="pending").length;
 $("orderCount").textContent=`${orders.length} order${orders.length===1?"":"s"}`;
 $("orderList").innerHTML=orders.length?orders.map(o=>`<div class="order-item"><div><strong>${escapeHtml(o.service_name)}</strong><span>${escapeHtml(String(o.id).slice(0,8))} · ${new Date(o.created_at).toLocaleString()}<br>${escapeHtml(o.details)}</span></div><div><span class="status">${escapeHtml(o.status)}</span><p>${money(o.price_mmk)} MMK</p></div></div>`).join(""):'Login and choose a service to place an order.';
 $("depositMessage").hidden=true;
 const account=$("accountStatus"); if(account) account.textContent=session?`${profile?.display_name||session.user.email} · ${profile?.role||"customer"}`:"Not logged in";
 const login=$("loginBtn"), reg=$("registerBtn"); if(session){login.textContent="♙ Logout";reg.hidden=true}else{login.textContent="♙ Login";reg.hidden=false}
 const adminBtn=$("adminToggle"); if(adminBtn) adminBtn.textContent=profile?.role==="admin"?"Admin Panel":"Account";
}
async function placeOrder(id){
 if(!requireLogin())return;const s=services.find(x=>x.id===id);if(!s)return;
 const details=prompt(`Order: ${s.name}\nEnter model and service details:`);if(details===null)return;if(!details.trim()){toast("Please enter order details.");return}
 const {error}=await sb.from("orders").insert({user_id:session.user.id,service_id:s.id,service_name:s.name,details:details.trim(),price_mmk:s.price,status:"pending"});
 if(error){toast(error.message.includes("row-level")?"Order permission error. Check database setup.":error.message);return}await refresh();toast("Order submitted successfully.");
}
async function submitDeposit(e){e.preventDefault();if(!requireLogin())return;
 const amount=Number($("depositAmount").value),txid=$("txid").value.trim(),network=$("network").value;
 if(!Number.isFinite(amount)||amount<=0||!txid){toast("Enter a valid amount and TxID.");return}
 const {error}=await sb.from("deposit_requests").insert({user_id:session.user.id,network,amount_usdt:amount,txid,status:"pending"});
 if(error){toast(error.message);return}$("depositForm").reset();$("depositMessage").hidden=false;$("depositMessage").textContent="Request submitted. Admin will verify the transaction before crediting your wallet.";await refresh();toast("Deposit request submitted.");
}
async function login(){if(!configured()){toast("Setup required: add Supabase URL and anon key in config.js.");return}
 if(session){const {error}=await sb.auth.signOut();if(error)toast(error.message);else{session=null;await refresh();toast("Logged out.")}return}
 const email=prompt("Email address:");if(!email)return;const password=prompt("Password:");if(!password)return;
 const {data,error}=await sb.auth.signInWithPassword({email:email.trim(),password});if(error){toast(error.message);return}session=data.session;await refresh();toast("Logged in successfully.");
}
async function register(){if(!configured()){toast("Setup required: add Supabase URL and anon key in config.js.");return}
 const name=prompt("Your name:");if(!name)return;const email=prompt("Email address:");if(!email)return;const password=prompt("Create a password (at least 8 characters):");if(!password)return;
 if(password.length<8){toast("Password must be at least 8 characters.");return}
 const {data,error}=await sb.auth.signUp({email:email.trim(),password,options:{data:{display_name:name.trim()}}});if(error){toast(error.message);return}
 if(data.session){session=data.session;await refresh();toast("Account created.")}else toast("Registration received. Check your email to confirm, then login.");
}
async function loadAdmin(){
 const [o,d]=await Promise.all([sb.from("orders").select("id,user_id,service_name,details,price_mmk,status,created_at").order("created_at",{ascending:false}),sb.from("deposit_requests").select("id,user_id,network,amount_usdt,txid,status,credited_mmk,created_at").order("created_at",{ascending:false})]);
 if(o.error||d.error){toast("Admin data unavailable. Check admin role and database policies.");return}
 $("adminPanel").hidden=false;$("adminOrders").textContent=o.data.length;$("adminDeposits").textContent=d.data.length;
 $("adminOrderList").innerHTML=o.data.length?o.data.map(x=>`<div class="order-item"><div><strong>${escapeHtml(x.service_name)} · ${String(x.id).slice(0,8)}</strong><span>User: ${escapeHtml(x.user_id)}<br>${escapeHtml(x.details)}<br>${money(x.price_mmk)} MMK</span></div><select data-order-status="${x.id}"><option value="pending" ${x.status==="pending"?"selected":""}>Pending</option><option value="in_progress" ${x.status==="in_progress"?"selected":""}>In progress</option><option value="completed" ${x.status==="completed"?"selected":""}>Completed</option><option value="rejected" ${x.status==="rejected"?"selected":""}>Rejected</option></select></div>`).join(""):'No orders.';
 $("adminDepositList").innerHTML=d.data.length?d.data.map(x=>`<div class="deposit-item"><div><strong>${escapeHtml(x.network)} · ${money(x.amount_usdt)} USDT</strong><span>TxID: ${escapeHtml(x.txid)}<br>User: ${escapeHtml(x.user_id)}<br>Status: ${escapeHtml(x.status)}${x.credited_mmk?` · ${money(x.credited_mmk)} MMK credited`:""}</span></div><div>${x.status==="pending"?`<button class="btn btn-primary" data-approve="${x.id}">Verify & Credit</button>`:`<span class="status">${escapeHtml(x.status)}</span>`}</div></div>`).join(""):'No deposit requests.';
 document.querySelectorAll("[data-order-status]").forEach(el=>el.addEventListener("change",async()=>{const {error}=await sb.from("orders").update({status:el.value}).eq("id",el.dataset.orderStatus);if(error)toast(error.message);else{toast("Order status updated.");await refresh()}}));
 document.querySelectorAll("[data-approve]").forEach(el=>el.addEventListener("click",async()=>{const amount=prompt("Enter MMK amount to credit after verifying the TxID on the correct blockchain explorer:");if(amount===null)return;const mmk=Number(amount);if(!Number.isFinite(mmk)||mmk<=0){toast("Enter a valid MMK amount.");return}const {error}=await sb.rpc("admin_approve_deposit",{p_deposit_id:el.dataset.approve,p_credit_mmk:mmk});if(error){toast(error.message);return}toast("Deposit approved and wallet credited.");await refresh()}));
}
function init(){renderServices();
 if(window.supabase&&window.FIXFLASH_CONFIG?.supabaseUrl?.startsWith("https://")&&window.FIXFLASH_CONFIG?.supabaseAnonKey&&!window.FIXFLASH_CONFIG.supabaseAnonKey.includes("PASTE_")){sb=window.supabase.createClient(window.FIXFLASH_CONFIG.supabaseUrl,window.FIXFLASH_CONFIG.supabaseAnonKey);sb.auth.onAuthStateChange((_event,s)=>{session=s;setTimeout(()=>refresh(),0)});sb.auth.getSession().then(({data})=>{session=data.session;refresh()});}
 else {toast("Backend setup needed — see SETUP.md.");render()}
 $("loginBtn").addEventListener("click",login);$("registerBtn").addEventListener("click",register);$("depositForm").addEventListener("submit",submitDeposit);
 $("adminToggle").addEventListener("click",()=>{if(profile?.role==="admin")loadAdmin();else toast(session?"Admin access only.":"Please login first.")});$("closeAdmin").addEventListener("click",()=>$ ("adminPanel").hidden=true);
}
init();
