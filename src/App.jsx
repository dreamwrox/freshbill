import { useState, useEffect } from "react";

// ─── STORAGE ───────────────────────────────────────────────────────────────
async function load(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
async function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── SUPABASE TRACKING ────────────────────────────────────────────────────
const SB_URL = "https://suwltzucwfknvljiftcd.supabase.co";
const SB_KEY = "sb_publishable_hbvCu6PRzDBeKzB2HXVtNg_oMMW3eM7";
const sbHeaders = { "Content-Type":"application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Prefer":"resolution=merge-duplicates" };

async function sbPing(deviceId, shopName, trialStart, isPaid, paidMonth, vendorWA) {
  if(!shopName || shopName==="Unknown Shop" || shopName==="Mera Fruit & Sabzi Store") return;
  try {
    const body = {
      device_id:   deviceId,
      last_seen:   new Date().toISOString(),
      shop_name:   shopName,
      trial_start: trialStart,
      is_paid:     isPaid,
      paid_month:  paidMonth || null,
    };
    if(vendorWA) body.vendor_wa = vendorWA;
    await fetch(`${SB_URL}/rest/v1/vendor_sessions`, {
      method: "POST",
      headers: { ...sbHeaders, "Prefer":"resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body)
    });
  } catch {}
}

// Public directory — vendors who've set their WhatsApp number, for customers to browse
async function sbFetchDirectory() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/vendor_sessions?vendor_wa=not.is.null&order=shop_name.asc&limit=200`, {
      headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` }
    });
    return await res.json();
  } catch { return []; }
}

async function sbBillTrack(deviceId, total) {
  try {
    // Increment bill count on vendor session
    await fetch(`${SB_URL}/rest/v1/rpc/increment_bill_count`, {
      method: "POST", headers: sbHeaders,
      body: JSON.stringify({ p_device_id: deviceId })
    });
    // Log individual bill event
    await fetch(`${SB_URL}/rest/v1/bill_events`, {
      method: "POST", headers: { ...sbHeaders, "Prefer":"return=minimal" },
      body: JSON.stringify({ device_id: deviceId, bill_total: total })
    });
  } catch {}
}

async function sbFetchVendors() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/vendor_sessions?order=last_seen.desc&limit=100`, {
      headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` }
    });
    return await res.json();
  } catch { return []; }
}

async function sbCustomerPing(deviceId, custName, vendorWA) {
  if(!custName || custName==="Unknown") return;
  try {
    await fetch(`${SB_URL}/rest/v1/customer_sessions`, {
      method: "POST",
      headers: { ...sbHeaders, "Prefer":"resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        device_id: deviceId,
        last_seen: new Date().toISOString(),
        cust_name: custName,
        vendor_wa: vendorWA || null,
      })
    });
  } catch {}
}

async function sbCustomerListSent(deviceId) {
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/increment_list_count`, {
      method: "POST", headers: sbHeaders,
      body: JSON.stringify({ p_device_id: deviceId })
    });
  } catch {}
}

async function sbFetchCustomers() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/customer_sessions?order=last_seen.desc&limit=100`, {
      headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` }
    });
    return await res.json();
  } catch { return []; }
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
  // ── FRUITS ──────────────────────────────────────────────────────────────
  { id:"apple",        name:"Apple / Seb",              emoji:"🍎", hi:"सेब", pa:"ਸੇਬ", cat:"fruit",   unit:"kg" },
  { id:"mango",        name:"Mango / Aam",              emoji:"🥭", hi:"आम", pa:"ਅੰਬ", cat:"fruit",   unit:"kg" },
  { id:"banana",       name:"Banana / Kela",            emoji:"🍌", hi:"केला", pa:"ਕੇਲਾ", cat:"fruit",   unit:"kg" },
  { id:"orange",       name:"Orange / Santra",          emoji:"🍊", hi:"संतरा", pa:"ਸੰਤਰਾ", cat:"fruit",   unit:"kg" },
  { id:"papaya",       name:"Papaya / Papita",          emoji:"🍑", hi:"पपीता", pa:"ਪਪੀਤਾ", cat:"fruit",   unit:"kg" },
  { id:"lichi",        name:"Lichi",                    emoji:"🍇", hi:"लीची", pa:"ਲੀਚੀ", cat:"fruit",   unit:"kg" },
  { id:"watermelon",   name:"Watermelon / Tarbooj",     emoji:"🍉", hi:"तरबूज़", pa:"ਤਰਬੂਜ਼", cat:"fruit",   unit:"piece" },
  { id:"muskmelon",    name:"Muskmelon / Kharbooja",    emoji:"🍈", hi:"खरबूजा", pa:"ਖ਼ਰਬੂਜ਼ਾ", cat:"fruit",   unit:"piece" },
  { id:"jamun",        name:"Jamun",                    emoji:"🫐", hi:"जामुन", pa:"ਜਾਮੁਣ", cat:"fruit",   unit:"kg" },
  { id:"guava",        name:"Guava / Amrood",           emoji:"🍐", hi:"अमरूद", pa:"ਅਮਰੂਦ", cat:"fruit",   unit:"kg" },
  { id:"anar",         name:"Pomegranate / Anar",       emoji:"❤️", hi:"अनार", pa:"ਅਨਾਰ", cat:"fruit",   unit:"piece" },
  { id:"grapes",       name:"Grapes / Angoor",          emoji:"🍇", hi:"अंगूर", pa:"ਅੰਗੂਰ", cat:"fruit",   unit:"kg" },
  { id:"strawberry",   name:"Strawberry",               emoji:"🍓", hi:"स्ट्रॉबेरी", pa:"ਸਟ੍ਰਾਬੇਰੀ", cat:"fruit",   unit:"kg" },
  { id:"coconut",      name:"Coconut / Nariyal",        emoji:"🥥", hi:"नारियल", pa:"ਨਾਰੀਅਲ", cat:"fruit",   unit:"piece" },
  { id:"pineapple",    name:"Pineapple / Ananas",       emoji:"🍍", hi:"अनानास", pa:"ਅਨਾਨਾਸ", cat:"fruit",   unit:"piece" },
  { id:"kiwi",         name:"Kiwi",                     emoji:"🥝", hi:"कीवी", pa:"ਕੀਵੀ", cat:"fruit",   unit:"kg" },
  { id:"lime",         name:"Lime / Nimbu",             emoji:"🍋", hi:"नींबू", pa:"ਨਿੰਬੂ", cat:"fruit",   unit:"kg" },
  { id:"cherry",       name:"Cherry",                   emoji:"🍒", hi:"चेरी", pa:"ਚੈਰੀ", cat:"fruit",   unit:"kg" },
  { id:"peach",        name:"Peach / Aadoo",            emoji:"🍑", hi:"आड़ू", pa:"ਆੜੂ", cat:"fruit",   unit:"kg" },
  { id:"pear",         name:"Pear / Nashpati",          emoji:"🍐", hi:"नाशपाती", pa:"ਨਾਸ਼ਪਾਤੀ", cat:"fruit",   unit:"kg" },
  { id:"dates",        name:"Dates / Khajoor",          emoji:"🌴", hi:"खजूर", pa:"ਖਜੂਰ", cat:"fruit",   unit:"kg" },
  { id:"fig",          name:"Fig / Anjeer",             emoji:"🫐", hi:"अंजीर", pa:"ਅੰਜੀਰ", cat:"fruit",   unit:"kg" },
  { id:"plum",         name:"Plum / Aloo Bukhara",      emoji:"🟣", hi:"आलूबुखारा", pa:"ਆਲੂਬੁਖਾਰਾ", cat:"fruit",   unit:"kg" },
  { id:"apricot",      name:"Apricot / Khumani",        emoji:"🟠", hi:"खुबानी", pa:"ਖੁਬਾਨੀ", cat:"fruit",   unit:"kg" },

  // ── VEGETABLES ───────────────────────────────────────────────────────────
  { id:"tomato",       name:"Tomato / Tamatar",         emoji:"🍅", hi:"टमाटर", pa:"ਟਮਾਟਰ", cat:"veggie",  unit:"kg" },
  { id:"potato",       name:"Potato / Aalu",            emoji:"🥔", hi:"आलू", pa:"ਆਲੂ", cat:"veggie",  unit:"kg" },
  { id:"onion",        name:"Onion / Pyaaz",            emoji:"🧅", hi:"प्याज़", pa:"ਪਿਆਜ਼", cat:"veggie",  unit:"kg" },
  { id:"garlic",       name:"Garlic / Lahsun",          emoji:"🧄", hi:"लहसुन", pa:"ਲਸਣ", cat:"veggie",  unit:"kg" },
  { id:"cauliflower",  name:"Cauliflower / Phool Gobhi",emoji:"🥦", hi:"फूलगोभी", pa:"ਫੁੱਲ ਗੋਭੀ", cat:"veggie",  unit:"piece" },
  { id:"cabbage",      name:"Cabbage / Patta Gobhi",    emoji:"🥬", hi:"पत्तागोभी", pa:"ਬੰਦ ਗੋਭੀ", cat:"veggie",  unit:"piece" },
  { id:"cucumber",     name:"Cucumber / Kheera",        emoji:"🥒", hi:"खीरा", pa:"ਖੀਰਾ", cat:"veggie",  unit:"kg" },
  { id:"carrot",       name:"Carrot / Gajar",           emoji:"🥕", hi:"गाजर", pa:"ਗਾਜਰ", cat:"veggie",  unit:"kg" },
  { id:"beans",        name:"Green Beans / Sem",        emoji:"🫛", hi:"सेम / फलियाँ", pa:"ਫਲੀਆਂ", cat:"veggie",  unit:"kg" },
  { id:"chilli",       name:"Green Chilli / Mirchi",    emoji:"🌶️", hi:"हरी मिर्च", pa:"ਹਰੀ ਮਿਰਚ", cat:"veggie",  unit:"kg" },
  { id:"spinach",      name:"Spinach / Palak",          emoji:"🥬", hi:"पालक", pa:"ਪਾਲਕ", cat:"veggie",  unit:"bunch" },
  { id:"brinjal",      name:"Brinjal / Baingan",        emoji:"🍆", hi:"बैंगन", pa:"ਬੈਂਗਣ", cat:"veggie",  unit:"kg" },
  { id:"lauki",        name:"Lauki / Bottle Gourd",     emoji:"🥒", hi:"लौकी", pa:"ਘੀਆ", cat:"veggie",  unit:"piece" },
  { id:"peas",         name:"Peas / Matar",             emoji:"🫛", hi:"मटर", pa:"ਮਟਰ", cat:"veggie",  unit:"kg" },
  { id:"corn",         name:"Corn / Makai",             emoji:"🌽", hi:"मक्का", pa:"ਮੱਕੀ", cat:"veggie",  unit:"piece" },
  { id:"radish",       name:"Radish / Mooli",           emoji:"⬜", hi:"मूली", pa:"ਮੂਲੀ", cat:"veggie",  unit:"kg" },
  { id:"beetroot",     name:"Beetroot / Chukandar",     emoji:"🟣", hi:"चुकंदर", pa:"ਚੁਕੰਦਰ", cat:"veggie",  unit:"kg" },
  { id:"pumpkin",      name:"Pumpkin / Kaddu",          emoji:"🎃", hi:"कद्दू", pa:"ਕੱਦੂ", cat:"veggie",  unit:"piece" },
  { id:"bellpepper",   name:"Bell Pepper / Shimla Mirch",emoji:"🫑",hi:"शिमला मिर्च", pa:"ਸ਼ਿਮਲਾ ਮਿਰਚ", cat:"veggie",  unit:"kg" },
  { id:"mushroom",     name:"Mushroom / Kumbhi",        emoji:"🍄", hi:"मशरूम / कुम्भी", pa:"ਖੁੰਬਾਂ", cat:"veggie",  unit:"kg" },
  { id:"methi",        name:"Fenugreek / Methi",        emoji:"🌿", hi:"मेथी", pa:"ਮੇਥੀ", cat:"veggie",  unit:"bunch" },
  { id:"coriander",    name:"Coriander / Dhaniya",      emoji:"🌿", hi:"धनिया", pa:"ਧਨੀਆ", cat:"veggie",  unit:"bunch" },
  { id:"mint",         name:"Mint / Pudina",            emoji:"🌱", hi:"पुदीना", pa:"ਪੁਦੀਨਾ", cat:"veggie",  unit:"bunch" },
  { id:"tinda",        name:"Tinda / Apple Gourd",      emoji:"🟢", hi:"टिंडा", pa:"ਟਿੰਡਾ", cat:"veggie",  unit:"kg" },
  { id:"karela",       name:"Bitter Gourd / Karela",    emoji:"💚", hi:"करेला", pa:"ਕਰੇਲਾ", cat:"veggie",  unit:"kg" },
  { id:"arbi",         name:"Arbi / Taro Root",         emoji:"🥔", hi:"अरबी", pa:"ਅਰਬੀ", cat:"veggie",  unit:"kg" },
  { id:"bharwa",       name:"Parwal / Pointed Gourd",   emoji:"🟩", hi:"परवल", pa:"ਪਰਵਲ", cat:"veggie",  unit:"kg" },
  { id:"drumstick",    name:"Drumstick / Sahjan",       emoji:"🌿", hi:"सहजन", pa:"ਸਹਿੰਜਣਾ", cat:"veggie",  unit:"piece" },
  { id:"sweetpotato",  name:"Sweet Potato / Shakarkand",emoji:"🍠", hi:"शकरकंद", pa:"ਸ਼ਕਰਕੰਦੀ", cat:"veggie",  unit:"kg" },
  { id:"broccoli",     name:"Broccoli",                 emoji:"🥦", hi:"ब्रोकली", pa:"ਬਰੋਕਲੀ", cat:"veggie",  unit:"piece" },
  { id:"leek",         name:"Leek / Hara Pyaz",         emoji:"🌱", hi:"हरा प्याज़", pa:"ਹਰਾ ਪਿਆਜ਼", cat:"veggie",  unit:"bunch" },
  { id:"zucchini",     name:"Zucchini / Tori",          emoji:"🥒", hi:"तोरी", pa:"ਤੋਰੀ", cat:"veggie",  unit:"kg" },
  { id:"turniip",      name:"Turnip / Shalgam",         emoji:"🟣", hi:"शलगम", pa:"ਸ਼ਲਗਮ", cat:"veggie",  unit:"kg" },

  // ── GROCERIES ────────────────────────────────────────────────────────────
  { id:"bread",        name:"Bread",                    emoji:"🍞", hi:"ब्रेड", pa:"ਬਰੈੱਡ", cat:"grocery", unit:"packet" },
  { id:"milk",         name:"Milk / Doodh",             emoji:"🥛", hi:"दूध", pa:"ਦੁੱਧ", cat:"grocery", unit:"litre" },
  { id:"paneer",       name:"Paneer",                   emoji:"🧀", hi:"पनीर", pa:"ਪਨੀਰ", cat:"grocery", unit:"kg" },
  { id:"butter",       name:"Butter / Makhan",          emoji:"🧈", hi:"मक्खन", pa:"ਮੱਖਣ", cat:"grocery", unit:"gm" },
  { id:"dahi",         name:"Dahi / Curd",              emoji:"🥛", hi:"दही", pa:"ਦਹੀਂ", cat:"grocery", unit:"kg" },
  { id:"eggs",         name:"Eggs / Ande",              emoji:"🥚", hi:"अंडे", pa:"ਆਂਡੇ", cat:"grocery", unit:"dozen" },
  { id:"buttermilk",   name:"Buttermilk / Chaach",      emoji:"🥤", hi:"छाछ", pa:"ਲੱਸੀ", cat:"grocery", unit:"litre" },
  { id:"ghee",         name:"Ghee",                     emoji:"🫙", hi:"घी", pa:"ਘਿਓ", cat:"grocery", unit:"kg" },
  { id:"oil",          name:"Cooking Oil / Tel",        emoji:"🫒", hi:"तेल", pa:"ਤੇਲ", cat:"grocery", unit:"litre" },
  { id:"mustardoil",   name:"Mustard Oil / Sarson Tel", emoji:"🫙", hi:"सरसों का तेल", pa:"ਸਰ੍ਹੋਂ ਦਾ ਤੇਲ", cat:"grocery", unit:"litre" },
  { id:"salt",         name:"Salt / Namak",             emoji:"🧂", hi:"नमक", pa:"ਲੂਣ", cat:"grocery", unit:"kg" },
  { id:"flour",        name:"Wheat Flour / Atta",       emoji:"🌾", hi:"आटा", pa:"ਆਟਾ", cat:"grocery", unit:"kg" },
  { id:"maida",        name:"Maida / Refined Flour",    emoji:"🌾", hi:"मैदा", pa:"ਮੈਦਾ", cat:"grocery", unit:"kg" },
  { id:"besan",        name:"Besan / Gram Flour",       emoji:"🟡", hi:"बेसन", pa:"ਬੇਸਣ", cat:"grocery", unit:"kg" },
  { id:"rice",         name:"Rice / Chawal",            emoji:"🍚", hi:"चावल", pa:"ਚੌਲ", cat:"grocery", unit:"kg" },
  { id:"dal",          name:"Dal / Lentils",            emoji:"🫘", hi:"दाल", pa:"ਦਾਲ", cat:"grocery", unit:"kg" },
  { id:"chana",        name:"Chana / Chickpeas",        emoji:"🫘", hi:"चना", pa:"ਛੋਲੇ", cat:"grocery", unit:"kg" },
  { id:"rajma",        name:"Rajma / Kidney Beans",     emoji:"🫘", hi:"राजमा", pa:"ਰਾਜਮਾ", cat:"grocery", unit:"kg" },
  { id:"sugar",        name:"Sugar / Cheeni",           emoji:"🍬", hi:"चीनी", pa:"ਖੰਡ", cat:"grocery", unit:"kg" },
  { id:"jaggery",      name:"Jaggery / Gur",            emoji:"🟫", hi:"गुड़", pa:"ਗੁੜ", cat:"grocery", unit:"kg" },
  { id:"honey",        name:"Honey / Shahad",           emoji:"🍯", hi:"शहद", pa:"ਸ਼ਹਿਦ", cat:"grocery", unit:"kg" },
  { id:"tea",          name:"Tea / Chai Patti",         emoji:"🍵", hi:"चाय पत्ती", pa:"ਚਾਹ ਪੱਤੀ", cat:"grocery", unit:"kg" },
  { id:"coffee",       name:"Coffee",                   emoji:"☕", hi:"कॉफ़ी", pa:"ਕੌਫ਼ੀ", cat:"grocery", unit:"kg" },
  { id:"ginger",       name:"Ginger / Adrak",           emoji:"🫚", hi:"अदरक", pa:"ਅਦਰਕ", cat:"grocery", unit:"kg" },
  { id:"turmeric",     name:"Turmeric / Haldi",         emoji:"🟡", hi:"हल्दी", pa:"ਹਲਦੀ", cat:"grocery", unit:"kg" },
  { id:"cumin",        name:"Cumin / Jeera",            emoji:"🟤", hi:"जीरा", pa:"ਜੀਰਾ", cat:"grocery", unit:"kg" },
  { id:"corianderpwd", name:"Coriander Powder / Dhania",emoji:"🟢", hi:"धनिया पाउडर", pa:"ਧਨੀਆ ਪਾਊਡਰ", cat:"grocery", unit:"kg" },
  { id:"redchilli",    name:"Red Chilli Powder",        emoji:"🌶️", hi:"लाल मिर्च पाउडर", pa:"ਲਾਲ ਮਿਰਚ ਪਾਊਡਰ", cat:"grocery", unit:"kg" },
  { id:"garammasala",  name:"Garam Masala",             emoji:"🌶️", hi:"गरम मसाला", pa:"ਗਰਮ ਮਸਾਲਾ", cat:"grocery", unit:"kg" },
  { id:"nuts",         name:"Mixed Nuts / Meva",        emoji:"🥜", hi:"मेवा", pa:"ਮੇਵੇ", cat:"grocery", unit:"kg" },
  { id:"cashew",       name:"Cashew / Kaju",            emoji:"🥜", hi:"काजू", pa:"ਕਾਜੂ", cat:"grocery", unit:"kg" },
  { id:"almond",       name:"Almond / Badam",           emoji:"🥜", hi:"बादाम", pa:"ਬਦਾਮ", cat:"grocery", unit:"kg" },
  { id:"dryfruit",     name:"Dry Fruits Mix",           emoji:"🍱", hi:"सूखे मेवे", pa:"ਸੁੱਕੇ ਮੇਵੇ", cat:"grocery", unit:"kg" },
  { id:"raisins",      name:"Raisins / Kishmish",       emoji:"🟤", hi:"किशमिश", pa:"ਕਿਸ਼ਮਿਸ਼", cat:"grocery", unit:"kg" },
  { id:"chocolate",    name:"Chocolate",                emoji:"🍫", hi:"चॉकलेट", pa:"ਚਾਕਲੇਟ", cat:"grocery", unit:"piece" },
  { id:"biscuit",      name:"Biscuits",                 emoji:"🍪", hi:"बिस्कुट", pa:"ਬਿਸਕੁਟ", cat:"grocery", unit:"packet" },
  { id:"namkeen",      name:"Namkeen / Snacks",         emoji:"🍿", hi:"नमकीन", pa:"ਨਮਕੀਨ", cat:"grocery", unit:"packet" },
  { id:"chips",        name:"Chips",                    emoji:"🥔", hi:"चिप्स", pa:"ਚਿਪਸ", cat:"grocery", unit:"packet" },
  { id:"noodles",      name:"Noodles / Maggi",          emoji:"🍜", hi:"नूडल्स", pa:"ਨੂਡਲਜ਼", cat:"grocery", unit:"packet" },
  { id:"poha",         name:"Poha / Flattened Rice",    emoji:"🍚", hi:"पोहा", pa:"ਪੋਹਾ", cat:"grocery", unit:"kg" },
  { id:"suji",         name:"Suji / Semolina",          emoji:"🌾", hi:"सूजी", pa:"ਸੂਜੀ", cat:"grocery", unit:"kg" },
  { id:"soap",         name:"Soap / Sabun",             emoji:"🧼", hi:"साबुन", pa:"ਸਾਬਣ", cat:"grocery", unit:"piece" },
  { id:"shampoo",      name:"Shampoo",                  emoji:"🧴", hi:"शैम्पू", pa:"ਸ਼ੈਂਪੂ", cat:"grocery", unit:"piece" },
  { id:"toothpaste",   name:"Toothpaste",               emoji:"🦷", hi:"टूथपेस्ट", pa:"ਟੂਥਪੇਸਟ", cat:"grocery", unit:"piece" },
  { id:"detergent",    name:"Detergent / Washing Powder",emoji:"🫧", hi:"डिटर्जेंट", pa:"ਡਿਟਰਜੈਂਟ", cat:"grocery", unit:"kg" },
  { id:"matchbox",     name:"Matchbox / Maachis",       emoji:"🔥", hi:"माचिस", pa:"ਮਾਚਿਸ", cat:"grocery", unit:"piece" },
  { id:"agarbatti",    name:"Agarbatti / Incense",      emoji:"🕯️", hi:"अगरबत्ती", pa:"ਅਗਰਬੱਤੀ", cat:"grocery", unit:"packet" },
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
function itemName(item, lang){
  if(lang==="hi" && item.hi) return item.hi;
  if(lang==="pa" && item.pa) return item.pa;
  return item.name.split("/")[0].trim();
}
function todayStr(){ return new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"2-digit",year:"numeric"}); }
function billId(){ return "B"+Date.now().toString().slice(-5); }

const GPAY_UPI   = "harjeet.pahwa-1@oksbi";
const GPAY_NAME  = "Harjit Singh Pahwa";
const ADMIN_WA   = "918800138095";

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
  const [appLang,      setAppLang]     = useState("en"); // "en" | "hi" | "pa"
  const [activeItem,   setActiveItem]  = useState(null);
  const [vendorList,   setVendorList]  = useState([]);
  const [vendorLoading,setVendorLoading]=useState(false);
  const [customerList, setCustomerList]= useState([]);
  const [custLoading,  setCustLoading] = useState(false);
  const [dashTab,      setDashTab]     = useState("vendors"); // "vendors" | "customers"
  const [tempShopName, setTempShopName]= useState("");
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
  const [shopSetup,    setShopSetup]   = useState(false); // true = vendor has set their name
  const [vendorOwnWA,  setVendorOwnWA] = useState("");    // vendor's own WhatsApp for customer directory
  const [selectedVendor,setSelectedVendor]=useState(null); // vendor customer picked from directory
  const [vendorDirectory,setVendorDirectory]=useState([]);
  const [dirLoading,   setDirLoading]  = useState(false);
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
  const [custList,     setCustList]    = useState([]);
  const [custOwnName,  setCustOwnName] = useState("");
  const [custVendorWA, setCustVendorWA]= useState("");
  const [custSearch,   setCustSearch]  = useState("");
  const [custSetup,    setCustSetup]   = useState(false);
  const [showWelcome,  setShowWelcome] = useState(false);
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
        if(d.appLang)   setAppLang(d.appLang);
        if(d.shopSetup) setShopSetup(d.shopSetup);
        if(d.vendorOwnWA) setVendorOwnWA(d.vendorOwnWA);
        if(d.trialStart)setTrialStart(d.trialStart);
        if(d.paidMonth) setPaidMonth(d.paidMonth);
        // Role is NOT restored — picker shows on every app open
        if(d.custVendorWA) setCustVendorWA(d.custVendorWA);
        if(d.custOwnName)  setCustOwnName(d.custOwnName);
        if(d.custSetup)    setCustSetup(d.custSetup);
        // Ping Supabase with real name from storage (only if name is set)
        if(d.shopSetup && d.shopName && d.shopName!=="Mera Fruit & Sabzi Store"){
          sbPing(deviceId, d.shopName, d.trialStart, !!d.paidMonth, d.paidMonth||null, d.vendorOwnWA);
        }
        if(d.custSetup && d.custOwnName){
          sbCustomerPing(deviceId, d.custOwnName, d.custVendorWA||"");
        }
      } else {
        const ts = Date.now();
        setTrialStart(ts);
        await save("fb-data-v2",{items:DEFAULT_ITEMS,rates:{},bills:[],shopName:"Mera Fruit & Sabzi Store",trialStart:ts,paidMonth:null});
        // Don't ping yet — wait for name to be entered
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
    save("fb-data-v2",{items,rates,bills,shopName,shopSetup,custSetup,trialStart,paidMonth,role,custVendorWA,custOwnName,appLang,vendorOwnWA});
  },[items,rates,bills,shopName,shopSetup,custSetup,trialStart,paidMonth,role,custVendorWA,custOwnName,appLang,vendorOwnWA,screen]);

  // ── RE-PING SUPABASE when shop name changes ──
  useEffect(()=>{
    if(!trialStart || !shopName || shopName==="Mera Fruit & Sabzi Store") return;
    const t = setTimeout(()=>{
      sbPing(deviceId, shopName, trialStart, !!paidMonth, paidMonth||null, vendorOwnWA);
    }, 1200);
    return ()=>clearTimeout(t);
  },[shopName, vendorOwnWA]);

  // ── RE-PING SUPABASE when customer name changes ──
  useEffect(()=>{
    if(!custOwnName) return;
    const t = setTimeout(()=>{
      sbCustomerPing(deviceId, custOwnName, custVendorWA);
    }, 1200);
    return ()=>clearTimeout(t);
  },[custOwnName]);

  // ── WELCOME MESSAGE for returning users ──
  useEffect(()=>{
    if(!role) return;
    const isReturning = role==="vendor" ? shopSetup : custSetup;
    const name = role==="vendor" ? shopName : custOwnName;
    if(isReturning && name){
      setShowWelcome(true);
      setTimeout(()=>setShowWelcome(false), 3500);
    }
  },[role]);

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
    const targetWA = selectedVendor?.vendor_wa || custVendorWA;
    const num = (targetWA||"").replace(/[^0-9]/g,"");
    if(!num){ notify("Dukandaar chuno ya number daalo!","error"); return; }
    let m=`🛒 *Meri Sabzi List*`;
    if(custOwnName) m+=`\n👤 ${custOwnName}`;
    if(selectedVendor) m+=`\n🏪 ${selectedVendor.shop_name}`;
    m+=`\n📅 ${todayStr()}\n\n`;
    custList.forEach((it,i)=>{ m+=`${i+1}. ${it.emoji} ${itemName(it, appLang)} — ${it.qty} ${it.unit}\n`; });
    m+=`\nBhaiya ye saman chahiye. Available hai? Rate aur total bata dena please 🙏`;
    const url=`https://wa.me/${num}?text=${encodeURIComponent(m)}`;
    window.open(url,"_blank");
    // Track list sent in Supabase
    sbCustomerPing(deviceId, custOwnName, num);
    sbCustomerListSent(deviceId);
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
    sbBillTrack(deviceId, billTotal); // ← track bill in Supabase
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
                window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`,"_blank");
              }} style={{width:"100%",padding:"13px 0",borderRadius:14,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:15,cursor:"pointer"}}>
                📲 WhatsApp pe Bhejo
              </button>
            </Card>
          )}

          <Card>
            <div style={{fontWeight:700,color:C.navy,marginBottom:8}}>📊 App Stats</div>
            <div style={{fontSize:14,color:C.gray}}>Total Bills (this device): <b style={{color:C.navy}}>{bills.length}</b></div>
            <div style={{fontSize:14,color:C.gray,marginTop:4}}>Current Month: <b style={{color:C.navy}}>{MONTH_KEY()}</b></div>
            <div style={{fontSize:14,color:C.gray,marginTop:4}}>Total Visitors: <b style={{color:C.green}}>{visitorCount!==null?visitorCount.toLocaleString("en-IN"):"…"}</b></div>
            <div style={{fontSize:14,color:C.gray,marginTop:4}}>Your Device ID: <b style={{color:C.navy,letterSpacing:2}}>{deviceId}</b></div>
          </Card>

          {/* ── LIVE VENDOR DASHBOARD ── */}
          <Card>
            {/* Tab switcher */}
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              <button onClick={()=>setDashTab("vendors")}
                style={{flex:1,padding:"8px 0",borderRadius:10,border:"none",background:dashTab==="vendors"?C.navy:"#E8F5E9",color:dashTab==="vendors"?"white":C.navy,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                🏪 Vendors ({vendorList.length})
              </button>
              <button onClick={()=>setDashTab("customers")}
                style={{flex:1,padding:"8px 0",borderRadius:10,border:"none",background:dashTab==="customers"?C.green:"#E8F5E9",color:dashTab==="customers"?"white":C.navy,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                🛍️ Grahak ({customerList.length})
              </button>
              <button onClick={async()=>{
                setVendorLoading(true); setCustLoading(true);
                const [vd, cd] = await Promise.all([sbFetchVendors(), sbFetchCustomers()]);
                setVendorList(Array.isArray(vd)?vd:[]);
                setCustomerList(Array.isArray(cd)?cd:[]);
                setVendorLoading(false); setCustLoading(false);
              }} style={{background:C.green,border:"none",color:"white",borderRadius:10,padding:"8px 12px",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {vendorLoading||custLoading?"…":"🔄"}
              </button>
            </div>

            {/* VENDORS TAB */}
            {dashTab==="vendors" && (<>
              {vendorList.length===0 && !vendorLoading && (
                <div style={{textAlign:"center",color:C.gray,padding:"16px 0",fontSize:13}}>
                  Refresh dabao — sab vendors ki list aayegi
                </div>
              )}
              {vendorList.map((v)=>{
                const diffH = Math.floor((new Date()-new Date(v.last_seen))/3600000);
                const when = diffH<1?"Just now":diffH<24?`${diffH}h ago`:`${Math.floor(diffH/24)}d ago`;
                const isActive = diffH < 48;
                return (
                  <div key={v.device_id} style={{borderBottom:`1px solid ${C.lgray}`,padding:"10px 0"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontWeight:700,fontSize:13,color:C.navy}}>{v.shop_name||"Unknown Shop"}</div>
                      <div style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20,background:isActive?"#E8F5E9":"#FEE2E2",color:isActive?C.green:"#DC2626"}}>
                        {isActive?"🟢 Active":"🔴 Inactive"}
                      </div>
                    </div>
                    <div style={{fontSize:11,color:C.gray,display:"flex",gap:10,flexWrap:"wrap",marginTop:3}}>
                      <span>📱 {v.device_id}</span>
                      <span>🧾 {v.bill_count||0} bills</span>
                      <span>⏰ {when}</span>
                      <span>{v.is_paid?"💚 Paid":"🔓 Trial"}</span>
                    </div>
                  </div>
                );
              })}
              {vendorList.length>0 && (
                <div style={{marginTop:10,padding:"8px",background:C.lgray,borderRadius:8,fontSize:12,color:C.gray,textAlign:"center"}}>
                  Total: <b style={{color:C.navy}}>{vendorList.length}</b> &nbsp;|&nbsp;
                  Active: <b style={{color:C.green}}>{vendorList.filter(v=>new Date()-new Date(v.last_seen)<48*3600000).length}</b> &nbsp;|&nbsp;
                  Paid: <b style={{color:C.gold}}>{vendorList.filter(v=>v.is_paid).length}</b>
                </div>
              )}
            </>)}

            {/* CUSTOMERS TAB */}
            {dashTab==="customers" && (<>
              {customerList.length===0 && !custLoading && (
                <div style={{textAlign:"center",color:C.gray,padding:"16px 0",fontSize:13}}>
                  Refresh dabao — sab grahak ki list aayegi
                </div>
              )}
              {customerList.map((c)=>{
                const diffH = Math.floor((new Date()-new Date(c.last_seen))/3600000);
                const when = diffH<1?"Just now":diffH<24?`${diffH}h ago`:`${Math.floor(diffH/24)}d ago`;
                const isActive = diffH < 48;
                return (
                  <div key={c.device_id} style={{borderBottom:`1px solid ${C.lgray}`,padding:"10px 0"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontWeight:700,fontSize:13,color:C.navy}}>{c.cust_name||"Unknown Customer"}</div>
                      <div style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20,background:isActive?"#E8F5E9":"#FEE2E2",color:isActive?C.green:"#DC2626"}}>
                        {isActive?"🟢 Active":"🔴 Inactive"}
                      </div>
                    </div>
                    <div style={{fontSize:11,color:C.gray,display:"flex",gap:10,flexWrap:"wrap",marginTop:3}}>
                      <span>📱 {c.device_id}</span>
                      <span>🛒 {c.list_count||0} lists sent</span>
                      <span>⏰ {when}</span>
                      {c.vendor_wa && <span>📞 {c.vendor_wa}</span>}
                    </div>
                  </div>
                );
              })}
              {customerList.length>0 && (
                <div style={{marginTop:10,padding:"8px",background:C.lgray,borderRadius:8,fontSize:12,color:C.gray,textAlign:"center"}}>
                  Total grahak: <b style={{color:C.navy}}>{customerList.length}</b> &nbsp;|&nbsp;
                  Active: <b style={{color:C.green}}>{customerList.filter(c=>new Date()-new Date(c.last_seen)<48*3600000).length}</b> &nbsp;|&nbsp;
                  Lists sent: <b style={{color:C.lgreen}}>{customerList.reduce((s,c)=>s+(c.list_count||0),0)}</b>
                </div>
              )}
            </>)}
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

      {/* Admin button — always visible on home screen */}
      <button onClick={()=>{
          setRole("vendor");
          setShopSetup(true);
          setShopName("JK Technologies — Admin");
          setScreen("home");
          setTab("rates");
          setShowAdmin(true);
          setAdminUnlocked(false);
          setAdminPass("");
          setGeneratedCode("");
          setAdminDevice("");
        }}
        style={{width:"100%",maxWidth:340,marginTop:20,padding:"14px 20px",borderRadius:16,border:"2px solid rgba(255,255,255,0.4)",background:"rgba(255,255,255,0.1)",color:"white",fontWeight:800,fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
        🔐 Admin Panel (Owner Only)
      </button>

      <div style={{color:"#A7F3D0",fontSize:11,marginTop:24,opacity:0.6}}>Designed by <b>JK Technologies</b> ™</div>
    </div>
  );

  // ── GRAHAK NAME SETUP (first time) ──
  if(role==="customer" && screen==="home" && !custSetup){
    return (
      <div style={{minHeight:"100vh",background:`linear-gradient(160deg,${C.green} 0%,${C.navy} 100%)`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"Segoe UI,sans-serif",padding:24}}>
        {toast && <Toast {...toast}/>}
        <div style={{fontSize:56,marginBottom:8}}>🛍️</div>
        <div style={{color:"white",fontSize:24,fontWeight:900,marginBottom:4}}>Aapka Naam?</div>
        <div style={{color:"#A7F3D0",fontSize:14,marginBottom:32,textAlign:"center"}}>Vendor ko pata chalega ki order kiska hai</div>
        <div style={{width:"100%",maxWidth:340}}>
          <input
            value={tempShopName}
            onChange={e=>setTempShopName(e.target.value)}
            placeholder="Apna naam likho... (e.g. Priya, Rahul)"
            autoFocus
            style={{width:"100%",padding:"16px",borderRadius:14,border:"none",fontSize:16,fontWeight:600,outline:"none",boxSizing:"border-box",marginBottom:12,textAlign:"center"}}
          />
          <button onClick={()=>{
            if(!tempShopName.trim()){ notify("Apna naam daalo!","error"); return; }
            const name = tempShopName.trim();
            setCustOwnName(name);
            setCustSetup(true);
            setTempShopName("");
            sbCustomerPing(deviceId, name, custVendorWA);
            notify(`✅ Swagat hai ${name}!`);
          }} style={{width:"100%",padding:"15px 0",borderRadius:14,border:"none",background:tempShopName.trim()?`linear-gradient(135deg,${C.green},#25D366)`:"rgba(255,255,255,0.3)",color:"white",fontWeight:900,fontSize:16,cursor:"pointer"}}>
            ✅ Shuru Karo
          </button>
        </div>
        <div style={{color:"#A7F3D0",fontSize:11,marginTop:28,opacity:0.6}}>Designed by <b>JK Technologies</b> ™</div>
      </div>
    );
  }

  // ── VENDOR PICKER (Grahak chooses a Dukandaar) ──
  if(role==="customer" && screen==="vendorPicker"){
    const q = custSearch.trim().toLowerCase();
    const filtered = vendorDirectory.filter(v=>!q || (v.shop_name||"").toLowerCase().includes(q));
    return (
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Segoe UI,sans-serif",paddingBottom:24}}>
        {toast && <Toast {...toast}/>}
        <div style={{background:`linear-gradient(135deg,${C.navy},${C.green})`,padding:"16px",color:"white"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:"white",fontSize:22,cursor:"pointer"}}>←</button>
            <div style={{fontWeight:900,fontSize:18}}>🏪 Dukandaar Chuno</div>
          </div>
          <input value={custSearch} onChange={e=>setCustSearch(e.target.value)} placeholder="🔍 Dukan ka naam dhoondo..."
            style={{width:"100%",padding:"11px 14px",borderRadius:12,border:"none",fontSize:14,boxSizing:"border-box",outline:"none"}}/>
        </div>

        <div style={{padding:16}}>
          <button onClick={async()=>{
            setDirLoading(true);
            const data = await sbFetchDirectory();
            setVendorDirectory(Array.isArray(data)?data:[]);
            setDirLoading(false);
          }} style={{width:"100%",padding:"11px 0",borderRadius:12,border:`1.5px solid ${C.green}`,background:"white",color:C.green,fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:14}}>
            {dirLoading?"Loading…":"🔄 Dukandaar List Refresh Karo"}
          </button>

          {filtered.length===0 && !dirLoading && (
            <div style={{textAlign:"center",color:C.gray,padding:"30px 0"}}>
              <div style={{fontSize:36}}>🏪</div>
              <div style={{marginTop:8,fontSize:14}}>Koi dukandaar nahi mila</div>
              <div style={{fontSize:12,marginTop:4}}>Upar "Refresh" dabao, ya neeche number type karo</div>
            </div>
          )}

          {filtered.map(v=>(
            <div key={v.device_id} onClick={()=>{
                setSelectedVendor(v);
                setCustVendorWA(v.vendor_wa||"");
                setScreen("home");
                notify(`✅ ${v.shop_name} select ho gaya`);
              }}
              style={{background:"white",borderRadius:14,padding:"14px 16px",marginBottom:10,boxShadow:"0 1px 8px rgba(0,0,0,0.06)",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,fontSize:15,color:C.navy}}>🏪 {v.shop_name}</div>
                {v.area && <div style={{fontSize:12,color:C.gray,marginTop:2}}>📍 {v.area}</div>}
                <div style={{fontSize:11,color:C.gray,marginTop:2}}>📞 {v.vendor_wa}</div>
              </div>
              <div style={{fontSize:18,color:C.green}}>›</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

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
                <div style={{fontWeight:700,fontSize:13,color:C.navy,marginTop:4}}>{itemName(it, appLang)}</div>
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

        {/* Welcome banner for returning grahak */}
        {showWelcome && custOwnName && (
          <div style={{position:"fixed",top:0,left:0,right:0,zIndex:999,background:`linear-gradient(135deg,${C.green},#25D366)`,color:"white",padding:"14px 20px",textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,0.2)"}}>
            <div style={{fontSize:20}}>👋 Wapas aaye {custOwnName}!</div>
            <div style={{fontSize:13,opacity:0.9,marginTop:2}}>Aaj kya chahiye? List banao 🛒</div>
          </div>
        )}

        <div style={{background:`linear-gradient(135deg,${C.navy},${C.green})`,padding:"18px 16px",color:"white",marginTop:showWelcome&&custOwnName?56:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div>
              <div style={{fontWeight:900,fontSize:18}}>🛍️ {custOwnName ? `Namaste, ${custOwnName}!` : "Meri Sabzi List"}</div>
              <div style={{fontSize:12,opacity:0.8,marginTop:2}}>Jo chahiye chuno, vendor ko bhejo</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setAppLang(appLang==="en"?"hi":appLang==="hi"?"pa":"en")}
                style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",borderRadius:10,padding:"8px 10px",fontWeight:800,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                {appLang==="en"?"🇬🇧 EN":appLang==="hi"?"🇮🇳 हिं":"☬ ਪੰ"}
              </button>
              <button onClick={()=>{setRole(null);setCustList([]);setScreen("home");}}
                style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",borderRadius:10,padding:"8px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>↩️ Change Role</button>
            </div>
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
                <div style={{fontSize:14,fontWeight:600,color:C.navy,flex:1}}>{it.emoji} {itemName(it, appLang)}</div>
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

            {selectedVendor ? (
              <div onClick={()=>setScreen("vendorPicker")} style={{marginTop:8,padding:"10px 12px",borderRadius:10,border:`2px solid ${C.lgreen}`,background:"#E8F5E9",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div><div style={{fontSize:11,color:C.gray}}>Dukandaar</div><div style={{fontWeight:700,fontSize:14,color:C.navy}}>🏪 {selectedVendor.shop_name}</div></div>
                <div style={{fontSize:12,color:C.green,fontWeight:700}}>Badlo ›</div>
              </div>
            ) : (
              <button onClick={()=>setScreen("vendorPicker")}
                style={{width:"100%",marginTop:8,padding:"12px 0",borderRadius:10,border:`2px dashed ${C.green}`,background:"#F0FFF4",color:C.green,fontWeight:700,fontSize:14,cursor:"pointer"}}>
                🏪 Dukandaar Chuno
              </button>
            )}
            <input value={custVendorWA} onChange={e=>setCustVendorWA(e.target.value)} placeholder="Ya WhatsApp number type karo (91...)" type="tel"
              style={{width:"100%",marginTop:8,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:13,boxSizing:"border-box",outline:"none"}}/>
            <button onClick={custSendWA}
              style={{width:"100%",marginTop:12,padding:"14px 0",borderRadius:14,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:16,cursor:"pointer"}}>
              📲 List Vendor Ko Bhejo
            </button>
            <div style={{textAlign:"center",fontSize:11,color:C.gray,margin:"10px 0"}}>— ya —</div>
            <button onClick={()=>{
              const num=(selectedVendor?.vendor_wa||custVendorWA||"").replace(/[^0-9]/g,"");
              if(!num){ notify("Pehle dukandaar chuno!","error"); return; }
              // Opens WhatsApp chat directly — customer can record & send a voice note there (free, native, reliable)
              window.open(`https://wa.me/${num}`,"_blank");
              notify("🎤 WhatsApp khul gaya — mic dabakar voice note bhejo!");
            }} style={{width:"100%",padding:"13px 0",borderRadius:14,border:`2px solid ${C.green}`,background:"#F0FFF4",color:C.green,fontWeight:800,fontSize:15,cursor:"pointer"}}>
              🎤 Voice Note Se Order Karo
            </button>
            <div style={{fontSize:11,color:C.gray,textAlign:"center",marginTop:6}}>WhatsApp khulega — mic icon dabakar bolo, vendor sunke samjhega</div>
          </div>
        )}
      </div>
    );
  }

  // ── SHOP NAME SETUP (first time vendor opens app) ──
  if(role==="vendor" && screen==="home" && !shopSetup){
    return (
      <div style={{minHeight:"100vh",background:`linear-gradient(160deg,${C.navy} 0%,${C.green} 100%)`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"Segoe UI,sans-serif",padding:24}}>
        {toast && <Toast {...toast}/>}
        <div style={{fontSize:56,marginBottom:8}}>🏪</div>
        <div style={{color:"white",fontSize:24,fontWeight:900,marginBottom:4}}>Aapki Dukan</div>
        <div style={{color:"#A7F3D0",fontSize:14,marginBottom:28,textAlign:"center"}}>Apni dukan ka naam daalo — yeh admin dashboard mein dikhega</div>
        <div style={{width:"100%",maxWidth:340}}>
          <input
            value={tempShopName}
            onChange={e=>setTempShopName(e.target.value)}
            placeholder="e.g. Ramesh Fruit & Sabzi Store"
            autoFocus
            style={{width:"100%",padding:"16px",borderRadius:14,border:"none",fontSize:16,fontWeight:600,outline:"none",boxSizing:"border-box",marginBottom:12,textAlign:"center"}}
          />
          <button
            onClick={()=>{
              if(!tempShopName.trim()){ notify("Dukan ka naam daalo!","error"); return; }
              const name = tempShopName.trim();
              setShopName(name);
              setShopSetup(true);
              setTempShopName("");
              sbPing(deviceId, name, trialStart, !!paidMonth, paidMonth||null, vendorOwnWA);
              notify("✅ Dukan save ho gayi!");
            }}
            style={{width:"100%",padding:"15px 0",borderRadius:14,border:"none",background:tempShopName.trim()?"linear-gradient(135deg,#128C7E,#25D366)":"rgba(255,255,255,0.3)",color:"white",fontWeight:900,fontSize:16,cursor:"pointer",marginBottom:12}}>
            ✅ Shuru Karo
          </button>

          {/* Admin / Owner shortcut */}
          <div style={{textAlign:"center",color:"#A7F3D0",fontSize:12,marginBottom:10,opacity:0.7}}>— ya —</div>
          <button
            onClick={()=>{
              setShopName("JK Technologies — Admin");
              setShopSetup(true);
              setTempShopName("");
              setShowAdmin(true);
              setAdminUnlocked(false);
              setAdminPass("");
            }}
            style={{width:"100%",padding:"13px 0",borderRadius:14,border:"2px solid rgba(255,255,255,0.4)",background:"rgba(255,255,255,0.1)",color:"white",fontWeight:700,fontSize:14,cursor:"pointer"}}>
            🔐 Main App Owner hoon (Admin Panel)
          </button>
        </div>
        <div style={{color:"#A7F3D0",fontSize:11,marginTop:28,opacity:0.6}}>Designed by <b>JK Technologies</b> ™</div>
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
                  <div><div style={{fontSize:13,fontWeight:600}}>{it.emoji} {itemName(it, appLang)}</div><div style={{fontSize:11,color:C.gray}}>{inr(it.rate)}/{it.unit}</div></div>
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

      {/* Welcome banner for returning vendor */}
      {showWelcome && shopName && shopName!=="JK Technologies — Admin" && (
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:999,background:`linear-gradient(135deg,${C.navy},${C.green})`,color:"white",padding:"14px 20px",textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,0.2)"}}>
          <div style={{fontSize:20}}>👋 Wapas aaye {shopName}!</div>
          <div style={{fontSize:13,opacity:0.9,marginTop:2}}>Aaj ke rates set karo aur bill banao 🧾</div>
        </div>
      )}

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
            <button onClick={()=>setAppLang(appLang==="en"?"hi":appLang==="hi"?"pa":"en")}
              style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",borderRadius:10,padding:"6px 11px",fontWeight:800,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}
              title="Bhasha badlo / Change language">
              {appLang==="en"?"🇬🇧 EN":appLang==="hi"?"🇮🇳 हिं":"☬ ਪੰ"}
            </button>
            <button onClick={()=>{setRole(null);setScreen("home");}}
              style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",borderRadius:10,padding:"6px 11px",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
              ↩️ Role
            </button>
            <button onClick={()=>{setShowAdmin(true);setAdminUnlocked(false);setAdminPass("");setGeneratedCode("");setAdminDevice("");}}
              style={{background:"rgba(255,255,255,0.25)",border:"2px solid rgba(255,255,255,0.5)",color:"white",borderRadius:10,padding:"6px 12px",fontWeight:800,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
              🔐 Admin
            </button>
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

          {/* Device ID Card — visible on home screen, one tap to send to admin */}
          <div style={{background:`linear-gradient(135deg,${C.navy},${C.green})`,borderRadius:16,padding:"14px 16px",marginBottom:14,color:"white"}}>
            <div style={{fontSize:12,opacity:0.8,marginBottom:2}}>📱 Aapka Device ID</div>
            <div style={{fontWeight:900,fontSize:28,letterSpacing:4,marginBottom:10}}>{deviceId}</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{
                const msg=`Namaste! 🙏\n\nMain FreshBill use kar raha/rahi hoon.\n\nMera Device ID: *${deviceId}*\nDukan: *${shopName}*\n\nPlease mujhe is mahine ka unlock code bhej dena. 🙏`;
                window.open(`https://wa.me/${ADMIN_WA}?text=${encodeURIComponent(msg)}`,"_blank");
              }} style={{flex:2,padding:"11px 0",borderRadius:12,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:13,cursor:"pointer"}}>
                📲 Device ID Bhejo
              </button>
              <button onClick={()=>setScreen("paywall")}
                style={{flex:1,padding:"11px 0",borderRadius:12,border:"2px solid rgba(255,255,255,0.5)",background:"rgba(255,255,255,0.15)",color:"white",fontWeight:800,fontSize:13,cursor:"pointer"}}>
                🔑 Code Daalo
              </button>
            </div>
          </div>

          {/* Customer Directory Listing — vendor's own WhatsApp number */}
          <div style={{background:"white",borderRadius:16,padding:"14px 16px",marginBottom:14,boxShadow:"0 1px 8px rgba(0,0,0,0.06)"}}>
            <div style={{fontWeight:700,color:C.navy,fontSize:14,marginBottom:4}}>📞 Apna WhatsApp Number (Grahak ke liye)</div>
            <div style={{fontSize:11,color:C.gray,marginBottom:10}}>Yeh number Grahak ko "Dukandaar chuno" list mein dikhega</div>
            <input
              value={vendorOwnWA}
              onChange={e=>setVendorOwnWA(e.target.value.replace(/[^0-9]/g,""))}
              placeholder="91XXXXXXXXXX"
              type="tel"
              style={{width:"100%",padding:"11px 13px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,boxSizing:"border-box",outline:"none"}}/>
            {vendorOwnWA && <div style={{fontSize:11,color:C.green,marginTop:6,fontWeight:600}}>✅ Aap Grahak ki list mein dikhoge</div>}
          </div>

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
                window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(m)}`,"_blank");
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
                      <div style={{fontSize:12,fontWeight:700,color:C.navy,textAlign:"center",marginTop:4,lineHeight:1.2}}>{itemName(item, appLang)}</div>
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
                    <div style={{fontWeight:600,fontSize:13,color:C.navy}}>{itemName(it, appLang)}</div>
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
