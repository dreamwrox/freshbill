import { useState, useEffect } from "react";

// ─── STORAGE ───────────────────────────────────────────────────────────────
// Uses localStorage on real devices (phone/Vercel). Persists across app restarts.
async function load(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
async function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── CODE SYSTEM ──────────────────────────────────────────────────────────
// Device fingerprint (stable per browser session)
function getDeviceId() {
  const nav = window.navigator;
  const raw = [nav.userAgent, nav.language, screen.width, screen.height, nav.hardwareConcurrency].join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash) + raw.charCodeAt(i); hash |= 0; }
  return Math.abs(hash).toString(36).toUpperCase().slice(0, 8);
}

const ADMIN_SECRET = "HARJIT2024"; // Only you know this — change it to anything private
const MONTH_KEY    = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; };

// Generate valid code for a deviceId + month (only you can compute this)
function generateCode(deviceId, monthKey, secret) {
  const raw = `${deviceId}-${monthKey}-${secret}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) + hash) + raw.charCodeAt(i); hash |= 0; }
  return Math.abs(hash).toString(36).toUpperCase().slice(0, 8);
}

function isValidCode(code, deviceId) {
  return generateCode(deviceId, MONTH_KEY(), ADMIN_SECRET) === code.trim().toUpperCase();
}

// ─── DEFAULTS ─────────────────────────────────────────────────────────────
const DEFAULT_ITEMS = [
  { id:"apple",      name:"Apple / Seb",            emoji:"🍎", cat:"fruit",  unit:"kg" },
  { id:"mango",      name:"Mango / Aam",            emoji:"🥭", cat:"fruit",  unit:"kg" },
  { id:"banana",     name:"Banana / Kela",          emoji:"🍌", cat:"fruit",  unit:"kg" },
  { id:"orange",     name:"Orange / Santra",        emoji:"🍊", cat:"fruit",  unit:"kg" },
  { id:"papaya",     name:"Papaya / Papita",        emoji:"🍈", cat:"fruit",  unit:"kg" },
  { id:"lichi",      name:"Lichi",                  emoji:"🍒", cat:"fruit",  unit:"kg" },
  { id:"watermelon", name:"Watermelon / Tarbooj",   emoji:"🍉", cat:"fruit",  unit:"piece" },
  { id:"muskmelon",  name:"Muskmelon / Kharbooja",  emoji:"🍈", cat:"fruit",  unit:"piece" },
  { id:"jamun",      name:"Jamun",                  emoji:"🫐", cat:"fruit",  unit:"kg" },
  { id:"guava",      name:"Guava / Amrood",         emoji:"🍐", cat:"fruit",  unit:"kg" },
  { id:"anar",       name:"Pomegranate / Anar",     emoji:"❤️", cat:"fruit",  unit:"piece" },
  { id:"grapes",     name:"Grapes / Angoor",        emoji:"🍇", cat:"fruit",  unit:"kg" },
  { id:"strawberry", name:"Strawberry",             emoji:"🍓", cat:"fruit",  unit:"kg" },
  { id:"coconut",    name:"Coconut / Nariyal",      emoji:"🥥", cat:"fruit",  unit:"piece" },
  { id:"pineapple",  name:"Pineapple / Ananas",     emoji:"🍍", cat:"fruit",  unit:"piece" },
  { id:"kiwi",       name:"Kiwi",                   emoji:"🥝", cat:"fruit",  unit:"kg" },
  { id:"lime",       name:"Lime / Nimbu",           emoji:"🍋", cat:"fruit",  unit:"kg" },
  
  { id:"tomato",     name:"Tomato / Tamatar",       emoji:"🍅", cat:"veggie", unit:"kg" },
  { id:"potato",     name:"Potato / Aalu",          emoji:"🥔", cat:"veggie", unit:"kg" },
  { id:"onion",      name:"Onion / Pyaaz",          emoji:"🧅", cat:"veggie", unit:"kg" },
  { id:"garlic",     name:"Garlic / Lahsun",        emoji:"🧄", cat:"veggie", unit:"kg" },
  { id:"cauliflower",name:"Cauliflower / Gobhi",    emoji:"🥦", cat:"veggie", unit:"piece" },
  { id:"cucumber",   name:"Cucumber / Kheera",      emoji:"🥒", cat:"veggie", unit:"kg" },
  { id:"carrot",     name:"Carrot / Gajar",         emoji:"🥕", cat:"veggie", unit:"kg" },
  { id:"beans",      name:"Beans / Sem",            emoji:"🫘", cat:"veggie", unit:"kg" },
  { id:"chilli",     name:"Green Chilli / Mirchi",  emoji:"🌶️", cat:"veggie", unit:"kg" },
  { id:"spinach",    name:"Spinach / Palak",        emoji:"🥬", cat:"veggie", unit:"bunch" },
  { id:"brinjal",    name:"Brinjal / Baingan",      emoji:"🍆", cat:"veggie", unit:"kg" },
  { id:"lauki",      name:"Lauki / Bottle Gourd",   emoji:"🫑", cat:"veggie", unit:"piece" },
  { id:"peas",       name:"Peas / Matar",           emoji:"🫛", cat:"veggie", unit:"kg" },
  { id:"corn",       name:"Corn / Makai",           emoji:"🌽", cat:"veggie", unit:"piece" },
  { id:"cabbage",    name:"Cabbage / Patta Gobhi",  emoji:"🥬", cat:"veggie", unit:"piece" },
  { id:"radish",     name:"Radish / Mooli",         emoji:"🥒", cat:"veggie", unit:"kg" },
  { id:"beetroot",   name:"Beetroot / Chukandar",   emoji:"🍅", cat:"veggie", unit:"kg" },
  { id:"pumpkin",    name:"Pumpkin / Kaddu",        emoji:"🎃", cat:"veggie", unit:"piece" },
  { id:"bellpepper", name:"Bell Pepper / Shimla",   emoji:"🫑", cat:"veggie", unit:"kg" },
  { id:"mushroom",   name:"Mushroom / Kumbhi",      emoji:"🍄", cat:"veggie", unit:"kg" },
  { id:"methi",      name:"Fenugreek / Methi",      emoji:"🌿", cat:"veggie", unit:"bunch" },
  
  { id:"bread",      name:"Bread / Eggless",        emoji:"🍞", cat:"grocery", unit:"packet" },
  { id:"milk",       name:"Milk",                   emoji:"🥛", cat:"grocery", unit:"litre" },
  { id:"paneer",     name:"Paneer",                 emoji:"🧀", cat:"grocery", unit:"kg" },
  { id:"butter",     name:"Butter",                 emoji:"🧈", cat:"grocery", unit:"kg" },
  { id:"dahi",       name:"Yogurt / Dahi",          emoji:"🥣", cat:"grocery", unit:"kg" },
  { id:"cheese",     name:"Cheese",                 emoji:"🧀", cat:"grocery", unit:"kg" },
  { id:"curd",       name:"Curd / Dahi",            emoji:"🥣", cat:"grocery", unit:"piece" },
  { id:"eggs",       name:"Eggs",                   emoji:"🥚", cat:"grocery", unit:"dozen" },
  { id:"buttermilk", name:"Buttermilk / Chaach",    emoji:"🥛", cat:"grocery", unit:"litre" },
  { id:"ghee",       name:"Ghee / Clarified Butter",emoji:"🧈", cat:"grocery", unit:"kg" },
  { id:"oil",        name:"Cooking Oil",            emoji:"🫒", cat:"grocery", unit:"litre" },
  { id:"salt",       name:"Salt",                   emoji:"🧂", cat:"grocery", unit:"kg" },
  { id:"flour",      name:"Flour / Atta",           emoji:"🌾", cat:"grocery", unit:"kg" },
  { id:"rice",       name:"Rice / Chawal",          emoji:"🍚", cat:"grocery", unit:"kg" },
  { id:"dal",        name:"Dal / Lentils",          emoji:"🍲", cat:"grocery", unit:"kg" },
  { id:"sugar",      name:"Sugar",                  emoji:"🍯", cat:"grocery", unit:"kg" },
  { id:"honey",      name:"Honey",                  emoji:"🍯", cat:"grocery", unit:"kg" },
  { id:"jam",        name:"Jam",                    emoji:"🍓", cat:"grocery", unit:"piece" },
  { id:"peanut",     name:"Peanut Butter",          emoji:"🥜", cat:"grocery", unit:"kg" },
  { id:"tea",        name:"Tea Leaves",             emoji:"🍵", cat:"grocery", unit:"kg" },
  { id:"coffee",     name:"Coffee",                 emoji:"☕", cat:"grocery", unit:"kg" },
  { id:"spices",     name:"Spices Mix",             emoji:"🌶️", cat:"grocery", unit:"kg" },
  { id:"ginger",     name:"Ginger / Adrak",         emoji:"🫚", cat:"grocery", unit:"kg" },
  { id:"turmeric",   name:"Turmeric / Haldi",       emoji:"🌾", cat:"grocery", unit:"kg" },
  { id:"nuts",       name:"Mixed Nuts",             emoji:"🥜", cat:"grocery", unit:"kg" },
  { id:"dryfruit",   name:"Dry Fruits",             emoji:"🥭", cat:"grocery", unit:"kg" },
  { id:"chocolate",  name:"Chocolate",              emoji:"🍫", cat:"grocery", unit:"piece" },
  { id:"biscuit",    name:"Biscuits",               emoji:"🍪", cat:"grocery", unit:"packet" },
  { id:"soap",       name:"Soap",                   emoji:"🧼", cat:"grocery", unit:"piece" },
];


const QUICK_RATES = [10,15,20,25,30,40,50,60,70,80,100,120,140,160,180,200,250,300];
const EMOJIS = ["🍎","🥭","🍌","🍊","🍈","🍒","🍉","🍇","🍐","❤️","🫐","🍅","🥔","🧅","🥦","🥒","🥕","🌶️","🥬","🍆","🫑","🫘","🫛","🌽","🧄"];
const UNITS  = ["kg","g","piece","dozen","bunch","packet","500g","250g","litre"];

const C = {
  navy:"#0A3D2E", green:"#1B6B3A", lgreen:"#25A244", gold:"#F59E0B",
  lgold:"#FEF3C7", bg:"#F0FAF4", white:"#FFFFFF", gray:"#6B7280",
  lgray:"#F3F4F6", dgray:"#1F2937", red:"#DC2626", lred:"#FEE2E2",
  blue:"#1565C0", lblue:"#EFF6FF",
};

function inr(n){ return "₹"+Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:2}); }
function todayStr(){ return new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"2-digit",year:"numeric"}); }
function billId(){ return "B"+Date.now().toString().slice(-5); }

const GPAY_UPI   = "harjeet.pahwa-1@oksbi";
const GPAY_NAME  = "Harjit Singh Pahwa";
const ADMIN_WA   = "91XXXXXXXXXX"; // Replace with your WhatsApp number

function Toast({msg,type}){
  const bg = type==="error"?C.red:type==="warn"?C.gold:C.navy;
  return <div style={{position:"fixed",top:16,left:16,right:16,zIndex:9999,background:bg,color:"white",borderRadius:14,padding:"13px 18px",fontWeight:700,fontSize:14,textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,0.25)"}}>{msg}</div>;
}

function Card({children,style={}}){
  return <div style={{background:"white",borderRadius:18,padding:16,boxShadow:"0 2px 12px rgba(0,0,0,0.07)",marginBottom:12,...style}}>{children}</div>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function App() {
  const [screen,       setScreen]      = useState("splash");
  const [tab,          setTab]         = useState("rates");
  const [items,        setItems]       = useState(DEFAULT_ITEMS);
  const [rates,        setRates]       = useState({});
  const [bills,        setBills]       = useState([]);
  const [shopName,     setShopName]    = useState("Mera Fruit & Sabzi Store");
  const [activeItem,   setActiveItem]  = useState(null);
  const [customRate,   setCustomRate]  = useState("");
  const [toast,        setToast]       = useState(null);
  const [billItems,    setBillItems]   = useState([]);
  const [custName,     setCustName]    = useState("");
  const [custPhone,    setCustPhone]   = useState("");
  const [previewBill,  setPreviewBill] = useState(null);
  const [editingId,    setEditingId]   = useState(null);
  const [showAddForm,  setShowAddForm] = useState(false);
  const [trialStart,   setTrialStart]  = useState(null);
  const [paidMonth,    setPaidMonth]   = useState(null); // "YYYYMM" if paid this month
  const [codeInput,    setCodeInput]   = useState("");
  const [codeError,    setCodeError]   = useState("");
  const [showAdmin,    setShowAdmin]   = useState(false);
  const [adminPass,    setAdminPass]   = useState("");
  const [adminUnlocked,setAdminUnlocked]=useState(false);
  const [visitorCount, setVisitorCount]= useState(null);
  const [generatedCode,setGeneratedCode]=useState("");
  const [adminDevice,  setAdminDevice] = useState("");
  const [newName,      setNewName]     = useState("");
  const [newEmoji,     setNewEmoji]    = useState("🥕");
  const [newUnit,      setNewUnit]     = useState("kg");
  const [newCat,       setNewCat]      = useState("veggie");
  const [showEmojiPick,setShowEmojiPick]=useState(false);
  const [role,         setRole]        = useState(null);   // "vendor" | "customer" | null
  const [custList,     setCustList]    = useState([]);     // customer's shopping list [{id,qty}]
  const [custOwnName,  setCustOwnName] = useState("");     // customer's own name
  const [custVendorWA, setCustVendorWA]= useState("");     // vendor's whatsapp number
  const [custSearch,   setCustSearch]  = useState("");
  const [rateSearch,   setRateSearch]  = useState("");

  const deviceId   = getDeviceId();
  const monthKey   = MONTH_KEY();
  const trialDays  = trialStart ? Math.max(0, 60 - Math.floor((Date.now()-trialStart)/(1000*60*60*24))) : 60;
  const trialActive= trialDays > 0;
  const isPaid     = paidMonth === monthKey;
  const canUse     = trialActive || isPaid;

  // ── LOAD ──
  useEffect(()=>{
    (async()=>{
      const d = await load("fb-data-v2");
      if(d){
        if(d.items){
          // Merge: keep saved items, add any new DEFAULT_ITEMS not already present (e.g. groceries)
          const savedIds = new Set(d.items.map(i=>i.id));
          const newDefaults = DEFAULT_ITEMS.filter(i=>!savedIds.has(i.id));
          setItems([...d.items, ...newDefaults]);
        }
        if(d.rates)     setRates(d.rates);
        if(d.bills)     setBills(d.bills);
        if(d.shopName)  setShopName(d.shopName);
        if(d.trialStart)setTrialStart(d.trialStart);
        if(d.paidMonth) setPaidMonth(d.paidMonth);
        // Role is NOT restored — picker shows on every app open
        if(d.custVendorWA) setCustVendorWA(d.custVendorWA);
        if(d.custOwnName)  setCustOwnName(d.custOwnName);
      } else {
        // First time — start trial
        const ts = Date.now();
        setTrialStart(ts);
        await save("fb-data-v2",{items:DEFAULT_ITEMS,rates:{},bills:[],shopName:"Mera Fruit & Sabzi Store",trialStart:ts,paidMonth:null});
      }
      setTimeout(()=>setScreen("home"),1600);
    })();
  },[]);

  // ── VISITOR COUNTER (free, no backend — api.counterapi.dev v1) ──
  useEffect(()=>{
    (async()=>{
      try{
        const seen = await load("fb-visited");
        // v1 REST format: https://api.counterapi.dev/v1/{namespace}/{key}/{up|}
        const base = "https://api.counterapi.dev/v1/freshbill-jk/visitors";
        const url = seen ? base : base+"/up";
        const res = await fetch(url);
        const data = await res.json();
        // v1 returns { count: N } ; some versions nest as { data:{ count:N } } or { value:N }
        const n = (data && (data.count ?? data.value ?? (data.data && (data.data.count ?? data.data.value))));
        if(typeof n==="number"){ setVisitorCount(n); }
        if(!seen) await save("fb-visited", true);
      }catch{ /* offline or blocked — silently ignore */ }
    })();
  },[]);

  // ── SAVE ──
  useEffect(()=>{
    if(screen==="splash"||!trialStart) return;
    save("fb-data-v2",{items,rates,bills,shopName,trialStart,paidMonth,role,custVendorWA,custOwnName});
  },[items,rates,bills,shopName,trialStart,paidMonth,role,custVendorWA,custOwnName,screen]);

  function notify(msg,type="success"){
    setToast({msg,type});
    setTimeout(()=>setToast(null),2800);
  }

  // ── CODE VERIFICATION ──
  function verifyCode(){
    setCodeError("");
    if(!codeInput.trim()){ setCodeError("Code daalo!"); return; }
    if(isValidCode(codeInput, deviceId)){
      setPaidMonth(monthKey);
      setCodeInput("");
      notify("🎉 Unlock ho gaya! Mubarak ho!");
      setScreen("home");
    } else {
      setCodeError("❌ Code galat hai ya expire ho gaya. Harjit bhai se dobara lo.");
    }
  }

  // ── RATES ──
  function setRate(id,val){ setRates(p=>({...p,[id]:val})); setActiveItem(null); setCustomRate(""); }
  function clearRate(id){ setRates(p=>{const n={...p};delete n[id];return n;}); }
  function removeItem(id){ setItems(p=>p.filter(i=>i.id!==id)); clearRate(id); setActiveItem(null); }
  function addCustomItem(){
    if(!newName.trim()) return;
    const id="c_"+Date.now();
    setItems(p=>[...p,{id,name:newName.trim(),emoji:newEmoji,cat:newCat,unit:newUnit}]);
    setNewName(""); setNewEmoji("🥕"); setNewUnit("kg"); setNewCat("veggie"); setShowAddForm(false); setShowEmojiPick(false);
    notify("✅ Item add ho gaya!");
  }

  // ── BILL ──
  const ratedItems = items.filter(i=>rates[i.id]);
  function addToBill(item){
    if(!canUse){ setScreen("paywall"); return; }
    setBillItems(p=>{ const ex=p.find(x=>x.id===item.id); if(ex) return p.map(x=>x.id===item.id?{...x,qty:x.qty+1}:x); return [...p,{...item,qty:1,rate:rates[item.id]||0}]; });
    notify(`🛒 ${item.name.split("/")[0]} add!`);
  }
  function updateBillQty(id,qty){ if(qty<=0){setBillItems(p=>p.filter(x=>x.id!==id));return;} setBillItems(p=>p.map(x=>x.id===id?{...x,qty}:x)); }
  const billTotal = billItems.reduce((s,x)=>s+x.qty*x.rate,0);

  // ── CUSTOMER LIST ──
  function custToggle(item){
    setCustList(p=>{ const ex=p.find(x=>x.id===item.id); if(ex) return p.filter(x=>x.id!==item.id); return [...p,{...item,qty:1}]; });
  }
  function custSetQty(id,qty){ if(qty<=0){setCustList(p=>p.filter(x=>x.id!==id));return;} setCustList(p=>p.map(x=>x.id===id?{...x,qty:Math.round(qty*100)/100}:x)); }
  function custSendWA(){
    if(!custList.length){ notify("Pehle kuch items chuno!","error"); return; }
    const num=custVendorWA.replace(/[^0-9]/g,"");
    let m=`🛒 *Meri Sabzi List*`;
    if(custOwnName) m+=`\n👤 ${custOwnName}`;
    m+=`\n📅 ${todayStr()}\n\n`;
    custList.forEach((it,i)=>{ m+=`${i+1}. ${it.emoji} ${it.name.split("/")[0].trim()} — ${it.qty} ${it.unit}\n`; });
    m+=`\nBhaiya ye saman chahiye. Available hai? Rate aur total bata dena please 🙏`;
    const url=`https://wa.me/${num}?text=${encodeURIComponent(m)}`;
    window.open(url,"_blank");
  }

  function generateBill(){
    if(!canUse){ setScreen("paywall"); return; }
    if(!billItems.length){ notify("Items add karo pehle!","error"); return; }
    if(editingId){
      // Updating an existing bill — keep its id & date, refresh everything else
      const updated={id:editingId,date:previewBill?.date||todayStr(),custName:custName||"Walk-in",custPhone,shopName,items:[...billItems],total:billTotal};
      setBills(p=>p.map(b=>b.id===editingId?updated:b));
      setPreviewBill(updated);
      setEditingId(null);
      setScreen("preview");
      notify("✅ Bill update ho gaya!");
      return;
    }
    const bill={id:billId(),date:todayStr(),custName:custName||"Walk-in",custPhone,shopName,items:[...billItems],total:billTotal};
    setBills(p=>[bill,...p]);
    setPreviewBill(bill);
    setScreen("preview");
  }

  // Load a saved bill back into the editor so qty / name / phone can be fixed
  function editBill(bill){
    setBillItems(bill.items.map(it=>({...it})));
    setCustName(bill.custName==="Walk-in"?"":bill.custName);
    setCustPhone(bill.custPhone||"");
    setEditingId(bill.id);
    setScreen("home");
    setTab("bill");
  }

  function waMsg(bill){
    let m=`🛒 *${bill.shopName}*\n📅 ${bill.date} | ${bill.id}\n👤 ${bill.custName}`;
    if(bill.custPhone) m+=` | 📞 ${bill.custPhone}`;
    m+=`\n\n*Saman / Items:*\n`;
    bill.items.forEach(it=>{ m+=`${it.emoji} ${it.name.split("/")[0].trim()} — ${it.qty} ${it.unit} × ${inr(it.rate)} = *${inr(it.qty*it.rate)}*\n`; });
    m+=`\n━━━━━━━━━━━━\n*Kul Total: ${inr(bill.total)}*\n\nShukriya! Dobara zaroor aana 🙏`;
    return encodeURIComponent(m);
  }

  // ── ADMIN PANEL (only you) ──
  if(showAdmin) return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Segoe UI,sans-serif",padding:20}}>
      <button onClick={()=>{setShowAdmin(false);setAdminUnlocked(false);setAdminPass("");}} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",marginBottom:16}}>←</button>
      <div style={{fontWeight:900,fontSize:22,color:C.navy,marginBottom:4}}>🔐 Admin Panel</div>
      <div style={{fontSize:13,color:C.gray,marginBottom:20}}>Sirf aap ke liye — customer ko dikhana mat</div>
      {!adminUnlocked ? (
        <Card>
          <div style={{fontWeight:700,color:C.navy,marginBottom:10}}>Admin Password</div>
          <input type="password" value={adminPass} onChange={e=>setAdminPass(e.target.value)}
            placeholder="Secret password daalo..."
            style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`1.5px solid ${C.lgray}`,fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:12}}/>
          <button onClick={()=>{ if(adminPass===ADMIN_SECRET){setAdminUnlocked(true);}else{notify("Galat password!","error");}}}
            style={{width:"100%",padding:"13px 0",borderRadius:14,border:"none",background:C.navy,color:"white",fontWeight:800,fontSize:15,cursor:"pointer"}}>
            🔓 Kholo
          </button>
        </Card>
      ):(
        <>
          <Card style={{background:C.navy}}>
            <div style={{color:"#A7F3D0",fontSize:12,marginBottom:4}}>Aapka Admin Code System</div>
            <div style={{color:"white",fontWeight:800,fontSize:16}}>Kisi bhi customer ka Device ID leke unka code generate karo</div>
          </Card>

          <Card>
            <div style={{fontWeight:700,color:C.navy,marginBottom:12}}>📱 Customer ka Device ID daalo</div>
            <input value={adminDevice} onChange={e=>setAdminDevice(e.target.value.toUpperCase())}
              placeholder="Customer ka Device ID (e.g. A3F2K9X1)"
              style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`1.5px solid ${C.lgray}`,fontSize:15,outline:"none",boxSizing:"border-box",letterSpacing:2,marginBottom:12}}/>
            <button onClick={()=>{
              if(!adminDevice.trim()){notify("Device ID daalo!","error");return;}
              const code = generateCode(adminDevice.trim(), MONTH_KEY(), ADMIN_SECRET);
              setGeneratedCode(code);
            }} style={{width:"100%",padding:"13px 0",borderRadius:14,border:"none",background:C.green,color:"white",fontWeight:800,fontSize:15,cursor:"pointer"}}>
              🔑 Code Generate Karo
            </button>
          </Card>

          {generatedCode && (
            <Card style={{border:`2px solid ${C.gold}`,background:C.lgold}}>
              <div style={{fontSize:12,color:C.gray,marginBottom:6}}>✅ Device: {adminDevice} ka {new Date().toLocaleDateString("en-IN",{month:"long",year:"numeric"})} ka code:</div>
              <div style={{fontSize:36,fontWeight:900,color:C.navy,letterSpacing:4,textAlign:"center",margin:"10px 0"}}>{generatedCode}</div>
              <div style={{fontSize:11,color:C.gray,textAlign:"center",marginBottom:12}}>Yeh code sirf {adminDevice} device pe aur sirf is mahine kaam karega</div>
              <button onClick={()=>{
                const msg = `🔑 *FreshBill Unlock Code*\n\nNamaste! Aapka is mahine ka unlock code:\n\n*${generatedCode}*\n\nApp mein "Enter Code" pe tap karke yeh code daalo.\n⚠️ Yeh code sirf aapke device pe kaam karega — kisi aur ko mat dena!\n\nShukriya 🙏\n— Harjit Bhai`;
                window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,"_blank");
              }} style={{width:"100%",padding:"13px 0",borderRadius:14,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:15,cursor:"pointer"}}>
                📲 WhatsApp pe Bhejo
              </button>
            </Card>
          )}

          <Card>
            <div style={{fontWeight:700,color:C.navy,marginBottom:8}}>📊 App Stats</div>
            <div style={{fontSize:14,color:C.gray}}>Total Bills: <b style={{color:C.navy}}>{bills.length}</b></div>
            <div style={{fontSize:14,color:C.gray,marginTop:4}}>Current Month: <b style={{color:C.navy}}>{MONTH_KEY()}</b></div>
            <div style={{fontSize:14,color:C.gray,marginTop:4}}>Total Visitors: <b style={{color:C.green}}>{visitorCount!==null?visitorCount.toLocaleString("en-IN"):"…"}</b></div>
            <div style={{fontSize:14,color:C.gray,marginTop:4}}>Your Device ID: <b style={{color:C.navy,letterSpacing:2}}>{deviceId}</b></div>
          </Card>
          <div style={{textAlign:"center",padding:"18px 0 8px",color:C.gray,fontSize:12}}>
            <div style={{fontWeight:700,color:C.navy}}>FreshBill v1.0</div>
            <div style={{marginTop:2}}>Designed by <b style={{color:C.green}}>JK Technologies</b> ™</div>
          </div>
        </>
      )}
    </div>
  );

  // ── ROLE PICKER ──
  if(screen!=="splash" && !role) return (
    <div style={{minHeight:"100vh",background:`linear-gradient(160deg,${C.navy} 0%,${C.green} 100%)`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"Segoe UI,sans-serif",padding:24}}>
      {toast && <Toast {...toast}/>}
      <div style={{fontSize:60,marginBottom:6}}>🥬</div>
      <div style={{color:"white",fontSize:28,fontWeight:900}}>FreshBill</div>
      <div style={{color:"#A7F3D0",fontSize:14,marginTop:6,marginBottom:38,textAlign:"center"}}>Aap kaun hain? / Who are you?</div>
      <button onClick={()=>{setRole("vendor");setScreen("home");setTab("rates");}}
        style={{width:"100%",maxWidth:340,background:"white",border:"none",borderRadius:20,padding:"22px 20px",marginBottom:16,cursor:"pointer",textAlign:"left",boxShadow:"0 6px 24px rgba(0,0,0,0.2)"}}>
        <div style={{fontSize:34}}>🧺</div>
        <div style={{fontWeight:900,fontSize:19,color:C.navy,marginTop:6}}>Main Dukaandaar hoon</div>
        <div style={{fontSize:13,color:C.gray,marginTop:3}}>Vendor — rate set karo, bill banao, WhatsApp bhejo</div>
      </button>
      <button onClick={()=>{setRole("customer");setScreen("home");}}
        style={{width:"100%",maxWidth:340,background:"white",border:"none",borderRadius:20,padding:"22px 20px",cursor:"pointer",textAlign:"left",boxShadow:"0 6px 24px rgba(0,0,0,0.2)"}}>
        <div style={{fontSize:34}}>🛍️</div>
        <div style={{fontWeight:900,fontSize:19,color:C.navy,marginTop:6}}>Main Grahak hoon</div>
        <div style={{fontSize:13,color:C.gray,marginTop:3}}>Customer — sabzi list banao aur vendor ko bhejo</div>
      </button>
      <div style={{color:"#A7F3D0",fontSize:11,marginTop:28,opacity:0.7}}>Har baar app khulne par yeh screen aayegi</div>
      <div style={{color:"#A7F3D0",fontSize:11,marginTop:24,opacity:0.6}}>Designed by <b>JK Technologies</b> ™</div>
    </div>
  );

  // ── CUSTOMER SCREEN ──
  if(role==="customer" && screen==="home"){
    const fr = items.filter(i=>i.cat==="fruit");
    const vg = items.filter(i=>i.cat==="veggie");
    const gr = items.filter(i=>i.cat==="grocery");
    const q = custSearch.trim().toLowerCase();
    const match = (arr)=> q ? arr.filter(i=>i.name.toLowerCase().includes(q)) : arr;
    const Section = ({title,arr})=> match(arr).length>0 && (
      <div style={{marginBottom:18}}>
        <div style={{fontWeight:800,color:C.navy,fontSize:14,margin:"0 0 10px 2px"}}>{title}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {match(arr).map(it=>{
            const sel=custList.find(x=>x.id===it.id);
            return (
              <div key={it.id} onClick={()=>custToggle(it)}
                style={{background:"white",borderRadius:14,padding:"12px",cursor:"pointer",position:"relative",boxShadow:sel?`0 0 0 2.5px ${C.lgreen}`:"0 1px 8px rgba(0,0,0,0.06)"}}>
                {sel && <div style={{position:"absolute",top:8,right:8,background:C.lgreen,color:"white",borderRadius:99,width:20,height:20,fontSize:12,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>✓</div>}
                <div style={{fontSize:30}}>{it.emoji}</div>
                <div style={{fontWeight:700,fontSize:13,color:C.navy,marginTop:4}}>{it.name.split("/")[0].trim()}</div>
                <div style={{fontSize:11,color:C.gray}}>per {it.unit}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
    return (
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Segoe UI,sans-serif",paddingBottom:custList.length?200:24}}>
        {toast && <Toast {...toast}/>}
        <div style={{background:`linear-gradient(135deg,${C.navy},${C.green})`,padding:"18px 16px",color:"white"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div>
              <div style={{fontWeight:900,fontSize:18}}>🛍️ Meri Sabzi List</div>
              <div style={{fontSize:12,opacity:0.8,marginTop:2}}>Jo chahiye chuno, vendor ko bhejo</div>
            </div>
            <button onClick={()=>{setRole(null);setCustList([]);setScreen("home");}}
              style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",borderRadius:10,padding:"8px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>↩️ Change Role</button>
          </div>
          <input value={custSearch} onChange={e=>setCustSearch(e.target.value)} placeholder="🔍 Sabzi/fruit/saman dhoondo..."
            style={{width:"100%",marginTop:14,padding:"11px 14px",borderRadius:12,border:"none",fontSize:14,boxSizing:"border-box",outline:"none"}}/>
        </div>
        <div style={{padding:"16px 14px 0"}}>
          <Section title="🥬 Sabziyan / Vegetables" arr={vg}/>
          <Section title="🍎 Phal / Fruits" arr={fr}/>
          <Section title="🛒 Groceries / Saman" arr={gr}/>
          {match(items).length===0 && <div style={{textAlign:"center",color:C.gray,padding:"40px 0"}}>Kuch nahi mila "{custSearch}"</div>}
          <div style={{textAlign:"center",padding:"20px 0 10px",color:C.gray,fontSize:12}}>
            <div>👥 Total Visitors: <b style={{color:C.green}}>{visitorCount!==null?visitorCount.toLocaleString("en-IN"):"…"}</b></div>
            <div style={{marginTop:6}}>Designed by <b style={{color:C.green}}>JK Technologies</b> ™</div>
          </div>
        </div>

        {custList.length>0 && (
          <div style={{position:"fixed",bottom:0,left:0,right:0,background:"white",borderRadius:"22px 22px 0 0",boxShadow:"0 -4px 24px rgba(0,0,0,0.15)",padding:"16px 14px",maxHeight:"55vh",overflowY:"auto"}}>
            <div style={{fontWeight:800,color:C.navy,marginBottom:4}}>📝 Meri List ({custList.length})</div>
            <div style={{fontSize:11,color:C.gray,marginBottom:10}}>Quantity badlne ke liye − / + dabao ya number type karo</div>
            {custList.map(it=>{
              const whole = ["piece","dozen","packet"].includes(it.unit);
              const step = whole ? 1 : 0.5;
              return (
              <div key={it.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.lgray}`}}>
                <div style={{fontSize:14,fontWeight:600,color:C.navy,flex:1}}>{it.emoji} {it.name.split("/")[0].trim()}</div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <button onClick={()=>custSetQty(it.id,it.qty-step)} style={{width:30,height:30,borderRadius:8,border:`1.5px solid ${C.lgray}`,background:"white",fontSize:17,cursor:"pointer",fontWeight:700}}>−</button>
                  <input type="number" inputMode="decimal" step={step} min="0" value={it.qty}
                    onChange={e=>{const v=parseFloat(e.target.value);custSetQty(it.id,isNaN(v)?0:v);}}
                    style={{width:50,height:30,textAlign:"center",fontWeight:800,fontSize:14,border:`1.5px solid ${C.lgreen}`,borderRadius:8,outline:"none",color:C.navy,padding:0}}/>
                  <span style={{fontSize:12,color:C.gray,width:40}}>{it.unit}</span>
                  <button onClick={()=>custSetQty(it.id,it.qty+step)} style={{width:30,height:30,borderRadius:8,border:`1.5px solid ${C.lgreen}`,background:"#E8F5E9",fontSize:17,cursor:"pointer",fontWeight:700,color:C.green}}>+</button>
                </div>
              </div>
              );
            })}
            <input value={custOwnName} onChange={e=>setCustOwnName(e.target.value)} placeholder="Aapka naam (optional)"
              style={{width:"100%",marginTop:12,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,boxSizing:"border-box",outline:"none"}}/>
            <input value={custVendorWA} onChange={e=>setCustVendorWA(e.target.value)} placeholder="Vendor ka WhatsApp number (91...)" type="tel"
              style={{width:"100%",marginTop:8,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,boxSizing:"border-box",outline:"none"}}/>
            <button onClick={custSendWA}
              style={{width:"100%",marginTop:12,padding:"14px 0",borderRadius:14,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:16,cursor:"pointer"}}>
              📲 List Vendor Ko Bhejo
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── SPLASH ──
  if(screen==="splash") return (
    <div style={{minHeight:"100vh",background:`linear-gradient(160deg,${C.navy} 0%,${C.green} 100%)`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"Segoe UI,sans-serif",padding:24}}>
      <div style={{fontSize:72,marginBottom:4}}>🥬</div>
      <div style={{color:"white",fontSize:32,fontWeight:900,letterSpacing:-1}}>FreshBill</div>
      <div style={{color:"#A7F3D0",fontSize:14,marginTop:4}}>Sabzi • Fruit • Bill • WhatsApp</div>
      <div style={{color:"#A7F3D0",fontSize:13,marginTop:32}}>Loading...</div>
      <div style={{position:"absolute",bottom:30,color:"#A7F3D0",fontSize:12,opacity:0.6}}>Designed by <b>JK Technologies</b> ™</div>
    </div>
  );

  // ── PAYWALL ──
  if(screen==="paywall") return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Segoe UI,sans-serif"}}>
      <div style={{background:`linear-gradient(135deg,${C.navy},${C.green})`,padding:"32px 20px 36px",color:"white",textAlign:"center"}}>
        <div style={{fontSize:44}}>🔐</div>
        <div style={{fontWeight:900,fontSize:24,marginTop:8}}>Free Trial Khatam!</div>
        <div style={{opacity:0.85,fontSize:14,marginTop:6}}>60 din poore ho gaye — ab sirf ₹30/month</div>
      </div>

      <div style={{padding:16}}>
        {/* Step 1 — Pay */}
        <Card style={{border:`2px solid ${C.gold}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{background:C.gold,color:"white",borderRadius:99,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:14,flexShrink:0}}>1</div>
            <div style={{fontWeight:800,fontSize:15,color:C.navy}}>GPay pe ₹30 bhejo</div>
          </div>
          <div style={{background:C.lgray,borderRadius:12,padding:"14px 16px",marginBottom:12}}>
            <div style={{fontSize:12,color:C.gray,marginBottom:4}}>UPI ID pe bhejo:</div>
            <div style={{fontWeight:900,fontSize:18,color:C.navy,letterSpacing:0.5}}>{GPAY_UPI}</div>
            <div style={{fontSize:12,color:C.gray,marginTop:2}}>{GPAY_NAME}</div>
          </div>
          <div style={{fontSize:12,color:C.gray,marginBottom:12,background:C.lblue,padding:"10px 12px",borderRadius:10}}>
            💡 Note mein likhna: <b>"FreshBill {deviceId}"</b> — taaki aapko jaldi code mile
          </div>
          <button onClick={()=>window.open(`upi://pay?pa=${GPAY_UPI}&pn=${encodeURIComponent(GPAY_NAME)}&am=100&cu=INR&tn=FreshBill+${deviceId}`,"_blank")}
            style={{width:"100%",padding:"14px 0",borderRadius:14,border:"none",background:`linear-gradient(135deg,#1A73E8,#4285F4)`,color:"white",fontWeight:800,fontSize:16,cursor:"pointer"}}>
            💳 GPay se Pay Karo ₹30
          </button>
        </Card>

        {/* Step 2 — WhatsApp screenshot */}
        <Card>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{background:C.green,color:"white",borderRadius:99,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:14,flexShrink:0}}>2</div>
            <div style={{fontWeight:800,fontSize:15,color:C.navy}}>Payment screenshot WhatsApp karo</div>
          </div>
          <div style={{background:C.lgray,borderRadius:10,padding:"10px 12px",marginBottom:12,fontSize:13,color:C.dgray}}>
            📱 Apna <b>Device ID</b> bhi bhejo:<br/>
            <span style={{fontWeight:900,letterSpacing:2,fontSize:16,color:C.navy}}>{deviceId}</span>
          </div>
          <button onClick={()=>{
            const msg=`Namaste Harjit bhai! 🙏\n\nMaine FreshBill ke liye ₹30 pay kar diya.\n\nMera Device ID: *${deviceId}*\n\nPlease mujhe is mahine ka unlock code bhej dena. Screenshot attach kar raha/rahi hoon.`;
            window.open(`https://wa.me/${ADMIN_WA}?text=${encodeURIComponent(msg)}`,"_blank");
          }} style={{width:"100%",padding:"13px 0",borderRadius:14,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:15,cursor:"pointer"}}>
            📲 WhatsApp karo (Screenshot ke saath)
          </button>
        </Card>

        {/* Step 3 — Enter code */}
        <Card>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{background:C.lgreen,color:"white",borderRadius:99,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:14,flexShrink:0}}>3</div>
            <div style={{fontWeight:800,fontSize:15,color:C.navy}}>Code milne ke baad yahan daalo</div>
          </div>
          <input value={codeInput} onChange={e=>{setCodeInput(e.target.value.toUpperCase());setCodeError("");}}
            placeholder="8-character code (e.g. A3B9K2X1)"
            maxLength={8}
            style={{width:"100%",padding:"14px 16px",borderRadius:12,border:`2px solid ${codeError?C.red:codeInput.length===8?C.green:C.lgray}`,fontSize:18,fontWeight:900,outline:"none",boxSizing:"border-box",letterSpacing:4,textAlign:"center",marginBottom:8,color:C.navy}}/>
          {codeError && <div style={{color:C.red,fontSize:13,marginBottom:8,textAlign:"center"}}>{codeError}</div>}
          <button onClick={verifyCode}
            style={{width:"100%",padding:"14px 0",borderRadius:14,border:"none",background:codeInput.length===8?`linear-gradient(135deg,${C.green},${C.lgreen})`:"#D1D5DB",color:"white",fontWeight:800,fontSize:16,cursor:"pointer"}}>
            🔓 Unlock Karo
          </button>
        </Card>

        {/* Warning */}
        <div style={{background:C.lred,borderRadius:12,padding:"12px 14px",marginBottom:12}}>
          <div style={{fontWeight:700,color:C.red,fontSize:13}}>⚠️ Dhyan rakho:</div>
          <div style={{fontSize:12,color:C.red,marginTop:4,lineHeight:1.6}}>
            • Yeh code sirf <b>aapke device</b> pe kaam karega<br/>
            • Code <b>kisi aur ko mat dena</b> — kaam nahi karega<br/>
            • Har mahine naya code lena padega
          </div>
        </div>

        {trialActive && (
          <button onClick={()=>setScreen("home")}
            style={{width:"100%",padding:"12px 0",borderRadius:14,border:`1.5px solid ${C.lgray}`,background:"white",color:C.gray,fontWeight:600,fontSize:14,cursor:"pointer"}}>
            ← Trial mein wapas jao ({trialDays} din bacha)
          </button>
        )}
      </div>
    </div>
  );

  // ── PREVIEW ──
  if(screen==="preview" && previewBill){
    const bill=previewBill;
    return (
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Segoe UI,sans-serif",paddingBottom:120}}>
        {toast && <Toast {...toast}/>}
        <div style={{background:`linear-gradient(135deg,${C.navy},${C.green})`,padding:"18px 16px 22px",color:"white",display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{setScreen("home");setTab("history");setBillItems([]);setCustName("");setCustPhone("");setEditingId(null);}} style={{background:"none",border:"none",color:"white",fontSize:22,cursor:"pointer"}}>←</button>
          <div><div style={{fontWeight:900,fontSize:18}}>Bill Ready! 🎉</div><div style={{fontSize:12,opacity:0.75}}>{bill.id} · {bill.date}</div></div>
        </div>

        <div style={{margin:"16px 14px 0",background:"white",borderRadius:20,overflow:"hidden",boxShadow:"0 6px 30px rgba(0,0,0,0.12)"}}>
          <div style={{background:`linear-gradient(135deg,${C.navy},${C.green})`,padding:"20px 20px 24px",color:"white"}}>
            <div style={{fontSize:22,fontWeight:900}}>{bill.shopName}</div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:14,fontSize:13,opacity:0.85}}>
              <div><div style={{fontSize:10,opacity:0.6,marginBottom:2}}>BILL NO</div><b>{bill.id}</b></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:10,opacity:0.6,marginBottom:2}}>DATE</div><b>{bill.date}</b></div>
            </div>
          </div>
          <div style={{padding:18}}>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:C.gray,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Grahak / Customer</div>
              <div style={{fontWeight:800,fontSize:16,color:C.navy,marginTop:4}}>{bill.custName}</div>
              {bill.custPhone && <div style={{fontSize:13,color:C.gray}}>📞 {bill.custPhone}</div>}
            </div>
            <div style={{borderRadius:12,overflow:"hidden",border:`1.5px solid ${C.lgray}`,marginBottom:14}}>
              <div style={{display:"grid",gridTemplateColumns:"3fr 1fr 1fr",background:C.navy,padding:"8px 12px"}}>
                {["Saman","Qty","Raqam"].map(h=><div key={h} style={{color:"white",fontSize:11,fontWeight:700}}>{h}</div>)}
              </div>
              {bill.items.map((it,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"3fr 1fr 1fr",padding:"10px 12px",background:i%2===0?"white":C.lgray,borderBottom:i<bill.items.length-1?`1px solid ${C.lgray}`:"none"}}>
                  <div><div style={{fontSize:13,fontWeight:600}}>{it.emoji} {it.name.split("/")[0].trim()}</div><div style={{fontSize:11,color:C.gray}}>{inr(it.rate)}/{it.unit}</div></div>
                  <div style={{fontSize:13,color:C.gray,alignSelf:"center"}}>{it.qty} {it.unit}</div>
                  <div style={{fontSize:13,fontWeight:800,color:C.navy,alignSelf:"center"}}>{inr(it.qty*it.rate)}</div>
                </div>
              ))}
            </div>
            <div style={{background:C.lgray,borderRadius:12,padding:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:800,fontSize:17,color:C.navy}}>Kul Total</span>
              <span style={{fontWeight:900,fontSize:22,color:C.green}}>{inr(bill.total)}</span>
            </div>
            <div style={{textAlign:"center",marginTop:14,color:C.gray,fontSize:13}}>Shukriya! Dobara zaroor aana 🙏</div>
          </div>
        </div>

        <div style={{padding:"16px 14px 0"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <button onClick={()=>window.open(`https://wa.me/${bill.custPhone||""}?text=${waMsg(bill)}`,"_blank")}
              style={{padding:"14px 0",borderRadius:14,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:15,cursor:"pointer"}}>
              📲 WhatsApp
            </button>
            <button onClick={()=>{navigator.clipboard?.writeText(decodeURIComponent(waMsg(bill)));notify("📋 Copy ho gaya!");}}
              style={{padding:"14px 0",borderRadius:14,border:`2px solid ${C.green}`,background:"white",color:C.green,fontWeight:800,fontSize:15,cursor:"pointer"}}>
              📋 Copy
            </button>
          </div>
          <button onClick={()=>editBill(bill)}
            style={{width:"100%",padding:"13px 0",borderRadius:14,border:`2px solid ${C.gold}`,background:C.lgold,color:C.navy,fontWeight:800,fontSize:15,cursor:"pointer",marginBottom:10}}>
            ✏️ Bill Edit Karo (Qty / Naam / Phone)
          </button>
          <button onClick={()=>window.print()}
            style={{width:"100%",padding:"13px 0",borderRadius:14,border:`2px solid ${C.navy}`,background:"white",color:C.navy,fontWeight:800,fontSize:15,cursor:"pointer",marginBottom:10}}>
            🖨️ Print / PDF
          </button>
          <button onClick={()=>{setScreen("home");setTab("bill");setBillItems([]);setCustName("");setCustPhone("");setEditingId(null);}}
            style={{width:"100%",padding:"12px 0",borderRadius:14,border:"none",background:C.lgray,color:C.gray,fontWeight:700,fontSize:14,cursor:"pointer"}}>
            ← Naya Bill Banao
          </button>
        </div>
      </div>
    );
  }

  // ── HOME ──
  const fruits  = items.filter(i=>i.cat==="fruit" && (rateSearch.trim()==="" || i.name.toLowerCase().includes(rateSearch.toLowerCase())));
  const veggies = items.filter(i=>i.cat==="veggie" && (rateSearch.trim()==="" || i.name.toLowerCase().includes(rateSearch.toLowerCase())));
  const grocery = items.filter(i=>i.cat==="grocery" && (rateSearch.trim()==="" || i.name.toLowerCase().includes(rateSearch.toLowerCase())));
  const billCount = billItems.reduce((s,x)=>s+x.qty,0);

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Segoe UI,sans-serif",paddingBottom:130}}>
      {toast && <Toast {...toast}/>}

      {/* HEADER */}
      <div style={{background:`linear-gradient(135deg,${C.navy},${C.green})`,padding:"14px 16px 0",color:"white",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{flex:1}}>
            <input value={shopName} onChange={e=>setShopName(e.target.value)}
              style={{background:"transparent",border:"none",color:"white",fontWeight:900,fontSize:17,outline:"none",width:"100%"}}
              placeholder="Dukan ka naam..."/>
            {isPaid && (
              <div style={{fontSize:11,opacity:0.7,marginTop:1,display:"flex",alignItems:"center",gap:8}}>
                <span style={{color:"#A7F3D0"}}>✅ Premium — {MONTH_KEY()}</span>
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>{setRole(null);setScreen("home");}}
              style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",borderRadius:10,padding:"6px 11px",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
              ↩️ Role
            </button>
            <button onClick={()=>{setShowAdmin(true);setAdminUnlocked(false);setAdminPass("");setGeneratedCode("");setAdminDevice("");}}
              style={{background:"rgba(255,255,255,0.15)",border:"none",color:"white",borderRadius:10,padding:"6px 10px",fontSize:16,cursor:"pointer"}}
              title="Admin Panel">⚙️</button>
          </div>
        </div>

        {/* Trial bar */}
        {!isPaid && trialActive && (
          <div style={{background:"rgba(0,0,0,0.2)",borderRadius:8,height:5,marginBottom:10,overflow:"hidden"}}>
            <div style={{background:C.gold,height:"100%",width:`${(trialDays/14)*100}%`,borderRadius:8,transition:"width 0.5s"}}/>
          </div>
        )}

        {/* Tabs */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",borderTop:"1px solid rgba(255,255,255,0.15)"}}>
          {[{k:"rates",l:"📋 Rates"},{k:"bill",l:`🛒 Bill${billCount>0?" ("+billCount+")":""}`},{k:"history",l:"🕐 History"}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)}
              style={{padding:"11px 0",border:"none",background:"transparent",color:"white",fontWeight:tab===t.k?900:400,fontSize:13,cursor:"pointer",borderBottom:tab===t.k?`3px solid ${C.gold}`:"3px solid transparent",opacity:tab===t.k?1:0.6}}>
              {t.l}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB: RATES ── */}
      {tab==="rates" && (
        <div style={{padding:"12px 12px 0"}}>
          <input value={rateSearch} onChange={e=>setRateSearch(e.target.value)} placeholder="🔍 Item dhoondo..."
            style={{width:"100%",marginBottom:12,padding:"11px 14px",borderRadius:12,border:`1.5px solid ${C.lgray}`,fontSize:14,outline:"none",boxSizing:"border-box"}}/>
          
          <button onClick={()=>{setShowAddForm(!showAddForm);setShowEmojiPick(false);}}
            style={{width:"100%",padding:"11px 0",borderRadius:12,border:`2px dashed ${C.lgreen}`,background:showAddForm?"#E8F5E9":"transparent",color:C.green,fontWeight:700,fontSize:14,cursor:"pointer",marginBottom:14}}>
            {showAddForm?"✕ Band Karo":"➕ Naya Item Add Karo"}
          </button>

          {showAddForm && (
            <Card>
              <div style={{fontWeight:700,color:C.navy,marginBottom:10}}>Naya Item</div>
              <button onClick={()=>setShowEmojiPick(!showEmojiPick)}
                style={{fontSize:28,background:C.lgray,border:"none",borderRadius:10,padding:"6px 12px",cursor:"pointer",marginBottom:10}}>{newEmoji}</button>
              {showEmojiPick && (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10,background:C.lgray,borderRadius:10,padding:10}}>
                  {EMOJIS.map(e=><button key={e} onClick={()=>{setNewEmoji(e);setShowEmojiPick(false);}} style={{fontSize:22,background:newEmoji===e?"#C8E6C9":"transparent",border:"none",borderRadius:8,padding:4,cursor:"pointer"}}>{e}</button>)}
                </div>
              )}
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Item ka naam..."
                style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,outline:"none",boxSizing:"border-box",marginBottom:8}}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                <select value={newUnit} onChange={e=>setNewUnit(e.target.value)} style={{padding:"10px 8px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:13,background:"white"}}>
                  {UNITS.map(u=><option key={u}>{u}</option>)}
                </select>
                <select value={newCat} onChange={e=>setNewCat(e.target.value)} style={{padding:"10px 8px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:13,background:"white"}}>
                  <option value="fruit">Fruit 🍎</option>
                  <option value="veggie">Sabzi 🥦</option>
                </select>
              </div>
              <button onClick={addCustomItem} style={{width:"100%",padding:"11px 0",borderRadius:12,border:"none",background:C.green,color:"white",fontWeight:800,fontSize:15,cursor:"pointer"}}>✅ Add Karo</button>
            </Card>
          )}

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[[`${ratedItems.length} items`,`Rate set`,C.green],[`${items.length-ratedItems.length} pending`,`Rate baaki`,C.gold]].map(([v,l,c])=>(
              <div key={l} style={{background:"white",borderRadius:14,padding:"12px 14px",boxShadow:"0 1px 8px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:20,fontWeight:900,color:c}}>{v}</div>
                <div style={{fontSize:12,color:C.gray}}>{l}</div>
              </div>
            ))}
          </div>

          {[{label:"🍎 Fruits / Phal",list:fruits},{label:"🥦 Vegetables / Sabzi",list:veggies},{label:"🛒 Groceries",list:grocery}].map(({label,list})=>(
            <div key={label} style={{marginBottom:18}}>
              <div style={{fontWeight:800,fontSize:15,color:C.navy,marginBottom:8}}>{label}</div>
              {list.map(item=>{
                const rate=rates[item.id]; const isActive=activeItem===item.id; const inB=billItems.find(x=>x.id===item.id);
                return (
                  <div key={item.id} style={{marginBottom:8}}>
                    <div onClick={()=>setActiveItem(isActive?null:item.id)}
                      style={{background:"white",borderRadius:isActive?"14px 14px 0 0":14,padding:"12px 14px",boxShadow:isActive?`0 0 0 2px ${C.lgreen}`:"0 1px 8px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",gap:10,cursor:"pointer",position:"relative"}}>
                      {inB && <div style={{position:"absolute",top:8,right:8,background:C.lgreen,color:"white",borderRadius:99,width:18,height:18,fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{inB.qty}</div>}
                      <span style={{fontSize:28}}>{item.emoji}</span>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:700,fontSize:14,color:C.navy}}>{item.name}</div>
                        <div style={{fontSize:11,color:C.gray}}>per {item.unit}</div>
                      </div>
                      {rate?(<div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{background:"#E8F5E9",color:C.green,fontWeight:900,fontSize:16,padding:"4px 12px",borderRadius:20}}>{inr(rate)}</div>
                        <button onClick={e=>{e.stopPropagation();clearRate(item.id);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#ccc"}}>✕</button>
                      </div>):(<div style={{color:"#ccc",fontSize:13}}>Tap ▾</div>)}
                    </div>
                    {isActive && (
                      <div style={{background:"white",borderRadius:"0 0 14px 14px",padding:"12px 14px 14px",boxShadow:"0 4px 16px rgba(0,0,0,0.08)"}}>
                        <div style={{fontSize:12,color:C.gray,marginBottom:8}}>Quick Rate (₹/{item.unit})</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                          {QUICK_RATES.map(r=>(
                            <button key={r} onClick={()=>setRate(item.id,r)}
                              style={{padding:"6px 11px",borderRadius:20,border:`1.5px solid ${rates[item.id]===r?C.green:"#E0E0E0"}`,background:rates[item.id]===r?C.green:"#F9FFF9",color:rates[item.id]===r?"white":C.green,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                              {r}
                            </button>
                          ))}
                        </div>
                        <div style={{display:"flex",gap:8,marginBottom:10}}>
                          <input type="number" placeholder="Custom..." value={customRate} onChange={e=>setCustomRate(e.target.value)}
                            style={{flex:1,padding:"9px 12px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,outline:"none"}}/>
                          <button onClick={()=>customRate&&setRate(item.id,Number(customRate))}
                            style={{padding:"9px 16px",borderRadius:10,border:"none",background:C.green,color:"white",fontWeight:700,cursor:"pointer"}}>Set</button>
                        </div>
                        {rate && <button onClick={()=>addToBill(item)}
                          style={{width:"100%",padding:"10px 0",borderRadius:10,border:"none",background:`linear-gradient(135deg,${C.gold},#FBBF24)`,color:"white",fontWeight:800,fontSize:14,cursor:"pointer",marginBottom:8}}>
                          🛒 Bill Mein Add Karo
                        </button>}
                        <button onClick={()=>removeItem(item.id)}
                          style={{width:"100%",padding:"9px 0",borderRadius:10,border:`1.5px solid ${C.red}44`,background:C.lred,color:C.red,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                          🗑️ List Se Hatao
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {ratedItems.length>0 && (
            <Card style={{marginTop:4}}>
              <div style={{fontWeight:700,color:C.navy,marginBottom:10}}>📢 Aaj ke Rates WhatsApp pe bhejo</div>
              <button onClick={()=>{
                let m=`🛒 *${shopName}*\n📅 Aaj ke Rates — ${todayStr()}\n\n`;
                const f=ratedItems.filter(i=>i.cat==="fruit"); const v=ratedItems.filter(i=>i.cat==="veggie"); const g=ratedItems.filter(i=>i.cat==="grocery");
                if(f.length){m+="*🍎 Fruits / Phal:*\n";f.forEach(i=>{m+=`${i.emoji} ${i.name.split("/")[0].trim()} — ${inr(rates[i.id])}/${i.unit}\n`;});m+="\n";}
                if(v.length){m+="*🥦 Sabzi:*\n";v.forEach(i=>{m+=`${i.emoji} ${i.name.split("/")[0].trim()} — ${inr(rates[i.id])}/${i.unit}\n`;});m+="\n";}
                if(g.length){m+="*🛒 Groceries:*\n";g.forEach(i=>{m+=`${i.emoji} ${i.name.split("/")[0].trim()} — ${inr(rates[i.id])}/${i.unit}\n`;});m+="\n";}
                m+="📲 _Order ke liye reply karein!_";
                window.open(`https://wa.me/?text=${encodeURIComponent(m)}`,"_blank");
              }} style={{width:"100%",padding:"13px 0",borderRadius:14,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:15,cursor:"pointer"}}>
                📲 Rates Bhejo ({ratedItems.length} items)
              </button>
            </Card>
          )}
          <div style={{textAlign:"center",padding:"18px 0 8px",color:C.gray,fontSize:12}}>
            <div>👥 Total Visitors: <b style={{color:C.green}}>{visitorCount!==null?visitorCount.toLocaleString("en-IN"):"…"}</b></div>
            <div style={{marginTop:6}}>Designed by <b style={{color:C.green}}>JK Technologies</b> ™</div>
          </div>
        </div>
      )}

      {/* ── TAB: BILL ── */}
      {tab==="bill" && (
        <div style={{padding:"12px 12px 0"}}>
          {!canUse && (
            <div style={{background:C.lred,borderRadius:14,padding:"14px 16px",marginBottom:14,textAlign:"center"}}>
              <div style={{fontWeight:800,color:C.red,fontSize:15}}>⚠️ Trial khatam ho gaya</div>
              <div style={{fontSize:13,color:C.red,marginTop:4}}>Bill banane ke liye ₹30/month pay karo</div>
              <button onClick={()=>setScreen("paywall")} style={{marginTop:10,padding:"9px 20px",borderRadius:12,border:"none",background:C.red,color:"white",fontWeight:700,cursor:"pointer"}}>Unlock Karo →</button>
            </div>
          )}
          {editingId && (
            <div style={{background:C.lgold,border:`2px solid ${C.gold}`,borderRadius:14,padding:"12px 16px",marginBottom:14,textAlign:"center"}}>
              <div style={{fontWeight:800,color:C.navy,fontSize:14}}>✏️ Bill {editingId} edit ho raha hai</div>
              <div style={{fontSize:12,color:C.gray,marginTop:2}}>Qty, naam ya phone theek karke neeche "Update" dabao</div>
            </div>
          )}
          <Card>
            <div style={{fontWeight:700,color:C.navy,marginBottom:10}}>👤 Grahak / Customer</div>
            <input value={custName} onChange={e=>setCustName(e.target.value)} placeholder="Naam (optional)"
              style={{width:"100%",padding:"11px 13px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,marginBottom:8,boxSizing:"border-box",outline:"none"}}/>
            <input value={custPhone} onChange={e=>setCustPhone(e.target.value)} placeholder="Phone (WhatsApp ke liye)" type="tel"
              style={{width:"100%",padding:"11px 13px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,boxSizing:"border-box",outline:"none"}}/>
          </Card>

          {ratedItems.length===0 ? (
            <Card><div style={{textAlign:"center",padding:"20px 0",color:C.gray}}>
              <div style={{fontSize:36}}>📋</div>
              <div style={{fontWeight:600,marginTop:8}}>Pehle rates set karo</div>
              <button onClick={()=>setTab("rates")} style={{marginTop:12,padding:"10px 20px",borderRadius:12,border:"none",background:C.green,color:"white",fontWeight:700,cursor:"pointer"}}>Rates Tab →</button>
            </div></Card>
          ):(
            <>
              <div style={{fontWeight:700,color:C.navy,marginBottom:8}}>Items chunno:</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                {ratedItems.map(item=>{
                  const inB=billItems.find(x=>x.id===item.id);
                  return (
                    <div key={item.id} onClick={()=>addToBill(item)}
                      style={{background:"white",borderRadius:14,padding:"12px",boxShadow:inB?`0 0 0 2.5px ${C.lgreen}`:"0 1px 8px rgba(0,0,0,0.06)",cursor:"pointer",position:"relative",opacity:canUse?1:0.5}}>
                      {inB && <div style={{position:"absolute",top:8,right:8,background:C.lgreen,color:"white",borderRadius:99,width:20,height:20,fontSize:11,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{inB.qty}</div>}
                      <div style={{fontSize:28,textAlign:"center"}}>{item.emoji}</div>
                      <div style={{fontSize:12,fontWeight:700,color:C.navy,textAlign:"center",marginTop:4,lineHeight:1.2}}>{item.name.split("/")[0].trim()}</div>
                      <div style={{fontSize:13,fontWeight:900,color:C.green,textAlign:"center",marginTop:4}}>{inr(rates[item.id])}/{item.unit}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {billItems.length>0 && (
            <Card>
              <div style={{fontWeight:700,color:C.navy,marginBottom:10}}>🛒 Bill Items</div>
              {billItems.map((it,i)=>(
                <div key={it.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:i<billItems.length-1?`1px solid ${C.lgray}`:"none"}}>
                  <span style={{fontSize:22}}>{it.emoji}</span>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13,color:C.navy}}>{it.name.split("/")[0].trim()}</div>
                    <div style={{fontSize:12,color:C.gray}}>{inr(it.rate)}/{it.unit}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <button onClick={()=>updateBillQty(it.id,Math.round((it.qty-0.5)*100)/100)} style={{width:28,height:28,borderRadius:8,border:`1.5px solid ${C.lgray}`,background:"white",fontSize:16,cursor:"pointer",fontWeight:700}}>−</button>
                    <input
                      type="number" inputMode="decimal" step="0.25" min="0"
                      value={it.qty}
                      onChange={e=>{ const v=parseFloat(e.target.value); setBillItems(p=>p.map(x=>x.id===it.id?{...x,qty:isNaN(v)?0:v}:x)); }}
                      onBlur={e=>{ if(!e.target.value||parseFloat(e.target.value)<=0) updateBillQty(it.id,0); }}
                      style={{width:50,height:30,textAlign:"center",fontWeight:800,fontSize:14,border:`1.5px solid ${C.lgray}`,borderRadius:8,outline:"none",color:C.navy,padding:0}}/>
                    <button onClick={()=>updateBillQty(it.id,Math.round((it.qty+0.5)*100)/100)} style={{width:28,height:28,borderRadius:8,border:`1.5px solid ${C.lgreen}`,background:"#E8F5E9",fontSize:16,cursor:"pointer",fontWeight:700,color:C.green}}>+</button>
                  </div>
                  <div style={{fontWeight:800,fontSize:14,color:C.navy,minWidth:52,textAlign:"right"}}>{inr(it.qty*it.rate)}</div>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",marginTop:12,padding:"12px 0 0",borderTop:`2px solid ${C.lgray}`}}>
                <span style={{fontWeight:800,fontSize:17,color:C.navy}}>Kul Total</span>
                <span style={{fontWeight:900,fontSize:20,color:C.green}}>{inr(billTotal)}</span>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── TAB: HISTORY ── */}
      {tab==="history" && (
        <div style={{padding:"12px 12px 0"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[["Total Bills",bills.length],["Kamaai",inr(bills.reduce((s,b)=>s+(b.total||0),0))]].map(([l,v])=>(
              <div key={l} style={{background:"white",borderRadius:14,padding:"14px",boxShadow:"0 1px 8px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:22,fontWeight:900,color:C.navy}}>{v}</div>
                <div style={{fontSize:12,color:C.gray,marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
          {bills.length===0?(
            <div style={{textAlign:"center",padding:"60px 0",color:C.gray}}>
              <div style={{fontSize:44}}>🧾</div>
              <div style={{fontWeight:600,marginTop:10}}>Koi bill nahi abhi tak</div>
            </div>
          ):bills.map((b)=>(
            <div key={b.id} onClick={()=>{setPreviewBill(b);setScreen("preview");}}
              style={{background:"white",borderRadius:14,padding:"14px 16px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 1px 8px rgba(0,0,0,0.06)",cursor:"pointer"}}>
              <div>
                <div style={{fontWeight:700,fontSize:14,color:C.navy}}>{b.custName}</div>
                <div style={{fontSize:12,color:C.gray,marginTop:2}}>{b.id} · {b.date}</div>
                <div style={{fontSize:12,color:C.gray}}>{b.items?.length} items</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontWeight:900,color:C.green,fontSize:16}}>{inr(b.total)}</div>
                <div style={{fontSize:11,color:C.lgreen,marginTop:4}}>Dekhein →</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FLOATING BUTTONS */}
      {tab==="bill" && billItems.length>0 && (
        <div style={{position:"fixed",bottom:16,left:12,right:12,zIndex:100}}>
          <button onClick={generateBill}
            style={{width:"100%",padding:"15px 20px",borderRadius:18,border:"none",background:`linear-gradient(135deg,${C.gold},#FBBF24)`,color:"white",fontWeight:900,fontSize:16,cursor:"pointer",boxShadow:"0 6px 24px rgba(245,158,11,0.5)",display:"flex",justifyContent:"space-between",alignItems:"center",boxSizing:"border-box"}}>
            <span>{editingId?"✏️ Bill Update Karo":"🧾 Bill Banao"}</span>
            <span>{inr(billTotal)} ({billItems.length} items)</span>
          </button>
        </div>
      )}
      {tab==="rates" && ratedItems.length>0 && !showAddForm && (
        <div style={{position:"fixed",bottom:16,left:12,right:12,zIndex:100}}>
          <button onClick={()=>setTab("bill")}
            style={{width:"100%",padding:"15px 0",borderRadius:18,border:"none",background:`linear-gradient(135deg,${C.green},${C.lgreen})`,color:"white",fontWeight:900,fontSize:16,cursor:"pointer",boxShadow:`0 6px 24px ${C.lgreen}66`}}>
            🧾 Bill Tab pe Jao →
          </button>
        </div>
      )}
    </div>
  );
}
