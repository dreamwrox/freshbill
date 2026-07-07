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
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1d2x0enVjd2ZrbnZsamlmdGNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3Mjg2MDksImV4cCI6MjA5ODMwNDYwOX0.nuw87hmkO9l0dPWO7Udbw7gJK14nN5sB8i5FtTL5wgQ";
const sbHeaders = { "Content-Type":"application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Prefer":"resolution=merge-duplicates" };

async function sbPing(deviceId, shopName, trialStart, isPaid, paidMonth, vendorWA, lat, lng, area) {
  // Skip only if there's nothing useful to save (no real name AND no WhatsApp number AND no location)
  const hasRealName = shopName && shopName!=="Unknown Shop" && shopName!=="Mera Fruit & Sabzi Store";
  if(!hasRealName && !vendorWA && !lat) return;
  try {
    const body = {
      device_id:   deviceId,
      last_seen:   new Date().toISOString(),
      shop_name:   shopName || "Unknown Shop",
      trial_start: trialStart,
      is_paid:     isPaid,
      paid_month:  paidMonth || null,
    };
    if(vendorWA) body.vendor_wa = vendorWA;
    if(lat) body.lat = lat;
    if(lng) body.lng = lng;
    if(area) body.area = area;
    const res = await fetch(`${SB_URL}/rest/v1/vendor_sessions`, {
      method: "POST",
      headers: { ...sbHeaders, "Prefer":"resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body)
    });
    if(!res.ok){ console.error("sbPing failed:", res.status, await res.text()); }
  } catch(e){ console.error("sbPing error:", e); }
}


// ── GPS & LOCATION HELPERS ──────────────────────────────────────────────────

// Get browser GPS coords — returns {lat, lng} or throws
function getBrowserLocation(){
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation){ reject(new Error("GPS is not supported on this device")); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error("GPS access denied. Please allow location in browser settings.")),
      { timeout: 10000, maximumAge: 60000 }
    );
  });
}

// Reverse geocode lat/lng to a human-readable area name using OpenStreetMap (free)
async function reverseGeocode(lat, lng){
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14`,
      { headers: { "Accept-Language":"en" } });
    const data = await res.json();
    const a = data.address||{};
    // Pick the most useful locality level
    return a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.city || a.county || "Unknown Area";
  } catch { return null; }
}

// Calculate distance in km between two GPS points (Haversine formula)
function distanceKm(lat1, lng1, lat2, lng2){
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Like sbPing but returns {ok, error} so the UI can show real success/failure
async function sbPingVerified(deviceId, shopName, trialStart, isPaid, paidMonth, vendorWA, shopNameHi, shopNamePa, area, lat, lng, photoUrl) {
  try {
    const body = {
      last_seen:   new Date().toISOString(),
      shop_name:   shopName || "Unknown Shop",
      trial_start: trialStart,
      is_paid:     isPaid,
      paid_month:  paidMonth || null,
      vendor_wa:   vendorWA,
    };
    if(shopNameHi) body.shop_name_hi = shopNameHi;
    if(shopNamePa) body.shop_name_pa = shopNamePa;
    if(area)       body.area = area;
    if(lat)        body.lat  = lat;
    if(lng)        body.lng  = lng;
    if(photoUrl)   body.photo_url = photoUrl;
    // First try to UPDATE the existing row (vendor already exists in DB)
    const patchRes = await fetch(`${SB_URL}/rest/v1/vendor_sessions?device_id=eq.${encodeURIComponent(deviceId)}`, {
      method: "PATCH",
      headers: { "Content-Type":"application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Prefer":"return=representation" },
      body: JSON.stringify(body)
    });
    if(patchRes.ok){
      const updated = await patchRes.json();
      if(Array.isArray(updated) && updated.length>0){ return { ok:true }; }
      // No existing row was updated → INSERT a new one
      const insertRes = await fetch(`${SB_URL}/rest/v1/vendor_sessions`, {
        method: "POST",
        headers: { "Content-Type":"application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Prefer":"return=minimal" },
        body: JSON.stringify({ device_id: deviceId, ...body })
      });
      if(insertRes.ok){ return { ok:true }; }
      return { ok:false, error:`Insert ${insertRes.status}: ${(await insertRes.text()).slice(0,150)}` };
    }
    return { ok:false, error:`Update ${patchRes.status}: ${(await patchRes.text()).slice(0,150)}` };
  } catch(e){ return { ok:false, error:e.message||"Network error" }; }
}


// ── LOCATION SEARCH: find ALL vendors (registered + unregistered) ─────────

// Step 1: Geocode area name → lat/lng using Nominatim (free)
async function geocodeArea(areaName) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(areaName+", India")}&format=json&limit=1`,
    { headers: { "Accept-Language":"en", "User-Agent":"FreshBill-App" } }
  );
  const data = await res.json();
  if(!Array.isArray(data)||!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name.split(",")[0] };
}

// Step 2: Find vegetable/grocery shops near lat/lng using Overpass API (free, no key)
async function fetchOsmVendors(lat, lng) {
  const radius = 2000;
  const query = `[out:json][timeout:20];(node["shop"~"greengrocer|vegetables|grocery|supermarket|general"](around:${radius},${lat},${lng});node["amenity"~"marketplace|market"](around:${radius},${lat},${lng});node["name"~"sabzi|fruit|veg|kirana|grocery|mandi|fresh",i](around:${radius},${lat},${lng}););out body 50;`;
  const res = await fetch("https://overpass-api.de/api/interpreter",{ method:"POST", body:query });
  if(!res.ok) return [];
  const data = await res.json();
  return (data.elements||[]).map(e=>({
    osm_id:   String(e.id),
    name:     e.tags?.name||e.tags?.["name:en"]||"Unnamed Vendor",
    lat:      e.lat, lng: e.lon,
    type:     e.tags?.shop||e.tags?.amenity||"vendor",
    phone:    e.tags?.phone||e.tags?.["contact:phone"]||null,
    address:  [e.tags?.["addr:street"],e.tags?.["addr:suburb"]].filter(Boolean).join(", ")||null,
  }));
}

// Step 3: Merge OSM results with registered vendors — mark which ones are in the app
function mergeVendorResults(osmPlaces, registeredVendors) {
  const dist2d = (lat1,lng1,lat2,lng2) => Math.sqrt(Math.pow((lat1-lat2)*111000,2)+Math.pow((lng1-lng2)*111000*Math.cos(lat1*Math.PI/180),2));
  const used = new Set();
  const out = [];

  osmPlaces.forEach(place=>{
    // Find matching registered vendor by GPS proximity (<200m) or name similarity
    const match = registeredVendors.find(v=>{
      if(used.has(v.device_id)) return false;
      if(v.lat&&v.lng&&place.lat&&place.lng && dist2d(v.lat,v.lng,place.lat,place.lng)<200) return true;
      if(v.shop_name&&place.name){
        const a=v.shop_name.toLowerCase().split(" ")[0], b=place.name.toLowerCase().split(" ")[0];
        return a.length>3 && b.length>3 && (a.includes(b)||b.includes(a));
      }
      return false;
    });
    if(match) used.add(match.device_id);
    out.push({ ...place, registered:!!match, vendor:match||null });
  });

  // Add registered vendors not matched to any OSM place
  registeredVendors.forEach(v=>{
    if(!used.has(v.device_id)){
      out.push({ osm_id:"reg_"+v.device_id, name:v.shop_name||"Unknown Shop",
        lat:v.lat, lng:v.lng, type:"greengrocer", phone:v.vendor_wa, address:v.area||null,
        registered:true, vendor:v });
      used.add(v.device_id);
    }
  });

  // Registered vendors first, then unregistered
  return [...out.filter(x=>x.registered), ...out.filter(x=>!x.registered)];
}

// Public directory — vendors who've set their WhatsApp number, for customers to browse
async function sbFetchDirectory() {
  try {
    // Fetch all vendor sessions, then filter for ones with a WhatsApp number in JS
    // (avoids query-syntax dependency on the vendor_wa column existing)
    const res = await fetch(`${SB_URL}/rest/v1/vendor_sessions?order=last_seen.desc&limit=300`, {
      headers: { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` }
    });
    if(!res.ok){
      const errText = await res.text();
      console.error("sbFetchDirectory failed:", res.status, errText);
      return { error: `${res.status}: ${errText.slice(0,180)}` };
    }
    const data = await res.json();
    if(!Array.isArray(data)) return { error: "Unexpected response: "+JSON.stringify(data).slice(0,120) };
    // Keep only vendors who have a usable WhatsApp number
    const withWA = data.filter(v=> v.vendor_wa && String(v.vendor_wa).replace(/[^0-9]/g,"").length >= 10);
    return withWA;
  } catch(e) { return { error: e.message||"Network error" }; }
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

async function sbCustomerPing(deviceId, custName, vendorWA, area, lat, lng) {
  if(!custName || custName==="Unknown") return;
  try {
    const body = {
      device_id: deviceId,
      last_seen: new Date().toISOString(),
      cust_name: custName,
      vendor_wa: vendorWA || null,
    };
    if(area) body.area = area;
    if(lat)  body.lat  = lat;
    if(lng)  body.lng  = lng;
    await fetch(`${SB_URL}/rest/v1/customer_sessions`, {
      method: "POST",
      headers: { ...sbHeaders, "Prefer":"resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body)
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

// Upload vendor photo to Supabase Storage and return public URL
async function sbUploadPhoto(deviceId, file) {
  try {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${deviceId}.${ext}`;
    const res = await fetch(`${SB_URL}/storage/v1/object/vendor-photos/${path}`, {
      method: "PUT",
      headers: {
        "apikey": SB_KEY,
        "Authorization": `Bearer ${SB_KEY}`,
        "Content-Type": file.type || "image/jpeg",
        "x-upsert": "true",
      },
      body: file,
    });
    if(!res.ok){ const e=await res.text(); return { error:`Upload failed ${res.status}: ${e.slice(0,100)}` }; }
    const publicUrl = `${SB_URL}/storage/v1/object/public/vendor-photos/${path}`;
    return { url: publicUrl };
  } catch(e){ return { error: e.message||"Upload failed" }; }
}

// Save photo URL back to vendor_sessions
async function sbSavePhotoUrl(deviceId, photoUrl) {
  try {
    await fetch(`${SB_URL}/rest/v1/vendor_sessions?device_id=eq.${encodeURIComponent(deviceId)}`, {
      method: "PATCH",
      headers: { "Content-Type":"application/json", "apikey":SB_KEY, "Authorization":`Bearer ${SB_KEY}`, "Prefer":"return=minimal" },
      body: JSON.stringify({ photo_url: photoUrl })
    });
  } catch {}
}

// Sync a single rate to Supabase when vendor sets it
async function sbSyncRate(deviceId, item, rate) {
  if(!rate || rate<=0) return;
  try {
    await fetch(`${SB_URL}/rest/v1/vendor_rates`, {
      method: "POST",
      headers: { ...sbHeaders, "Prefer":"resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        device_id:    deviceId,
        item_id:      item.id,
        item_name:    item.name.split("/")[0].trim(),
        item_name_hi: item.hi || "",
        item_name_pa: item.pa || "",
        item_emoji:   item.emoji,
        item_unit:    item.unit,
        rate:         rate,
        updated_at:   new Date().toISOString(),
      })
    });
  } catch {}
}

// Fetch all vendor rates for a specific item — for comparison
async function sbFetchItemRates(itemId) {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/vendor_rates?item_id=eq.${encodeURIComponent(itemId)}&order=rate.asc&limit=50`,
      { headers: { "apikey":SB_KEY, "Authorization":`Bearer ${SB_KEY}` } }
    );
    if(!res.ok) return { error: await res.text() };
    const rates = await res.json();
    if(!Array.isArray(rates)) return { error:"Bad response" };
    // Enrich with vendor info (shop name, photo, area, WA number)
    const deviceIds = [...new Set(rates.map(r=>r.device_id))];
    if(!deviceIds.length) return [];
    const inList = deviceIds.map(id=>`"${id}"`).join(",");
    const vsRes = await fetch(
      `${SB_URL}/rest/v1/vendor_sessions?device_id=in.(${inList})&select=device_id,shop_name,shop_name_hi,shop_name_pa,photo_url,area,vendor_wa`,
      { headers: { "apikey":SB_KEY, "Authorization":`Bearer ${SB_KEY}` } }
    );
    const vendors = vsRes.ok ? await vsRes.json() : [];
    const vendorMap = {};
    if(Array.isArray(vendors)) vendors.forEach(v=>{ vendorMap[v.device_id]=v; });
    return rates.map(r=>({ ...r, vendor: vendorMap[r.device_id]||{} }));
  } catch(e){ return { error:e.message||"Network error" }; }
}

// Fetch all unique items that have at least one vendor rate (for the picker)
async function sbFetchRatedItems() {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/vendor_rates?select=item_id,item_name,item_name_hi,item_name_pa,item_emoji,item_unit&order=item_name.asc`,
      { headers: { "apikey":SB_KEY, "Authorization":`Bearer ${SB_KEY}` } }
    );
    if(!res.ok) return [];
    const data = await res.json();
    if(!Array.isArray(data)) return [];
    // Deduplicate by item_id
    const seen = new Set();
    return data.filter(i=>{ if(seen.has(i.item_id)) return false; seen.add(i.item_id); return true; });
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

  // ── MISSING VEGETABLES (added) ──
  { id:"lotusstem",    name:"Lotus Stem / Kamal Kakdi", emoji:"🪷", hi:"कमल ककड़ी", pa:"ਕਮਲ ਕੱਕੜੀ", cat:"veggie", unit:"kg" },
  { id:"ladyfinger",   name:"Lady Finger / Bhindi",     emoji:"🟢", hi:"भिंडी", pa:"ਭਿੰਡੀ", cat:"veggie", unit:"kg" },
  { id:"jackfruit",    name:"Jackfruit / Kathal",       emoji:"🟡", hi:"कटहल", pa:"ਕਟਹਲ", cat:"veggie", unit:"kg" },
  { id:"gwarphali",    name:"Cluster Beans / Gwar",     emoji:"🟢", hi:"ग्वार फली", pa:"ਗਵਾਰ ਫਲੀ", cat:"veggie", unit:"kg" },
  { id:"chichinda",    name:"Snake Gourd / Chichinda",  emoji:"🟢", hi:"चिचिंडा", pa:"ਚਿਚਿੰਡਾ", cat:"veggie", unit:"kg" },
  { id:"ashgourd",     name:"Ash Gourd / Petha",        emoji:"🟢", hi:"पेठा", pa:"ਪੇਠਾ", cat:"veggie", unit:"kg" },
  { id:"rawbanana",    name:"Raw Banana / Kacha Kela",  emoji:"🍌", hi:"कच्चा केला", pa:"ਕੱਚਾ ਕੇਲਾ", cat:"veggie", unit:"kg" },
  { id:"rawpapaya",    name:"Raw Papaya / Kacha Papita",emoji:"🟢", hi:"कच्चा पपीता", pa:"ਕੱਚਾ ਪਪੀਤਾ", cat:"veggie", unit:"kg" },
  { id:"kundru",       name:"Ivy Gourd / Kundru",       emoji:"🟢", hi:"कुंदरू", pa:"ਕੁੰਦਰੂ", cat:"veggie", unit:"kg" },
  { id:"amaranth",     name:"Amaranth / Chaulai",       emoji:"🌿", hi:"चौराई", pa:"ਚੌਲਾਈ", cat:"veggie", unit:"bunch" },
  { id:"bathhua",      name:"Goosefoot / Bathhua",      emoji:"🌿", hi:"बथुआ", pa:"ਬਥੂਆ", cat:"veggie", unit:"bunch" },
  { id:"sarson",       name:"Mustard Greens / Sarson",  emoji:"🥬", hi:"सरसों पत्ता", pa:"ਸਰ੍ਹੋਂ ਦਾ ਸਾਗ", cat:"veggie", unit:"bunch" },
  { id:"kohlrabi",     name:"Kohlrabi / Ganth Gobhi",   emoji:"🟢", hi:"गांठ गोभी", pa:"ਗੰਢ ਗੋਭੀ", cat:"veggie", unit:"kg" },
  { id:"jimikand",     name:"Elephant Yam / Jimikand",  emoji:"🥔", hi:"जिमीकंद", pa:"ਜਿਮੀਕੰਦ", cat:"veggie", unit:"kg" },
  { id:"bananaflower", name:"Banana Flower",            emoji:"🌸", hi:"केले का फूल", pa:"ਕੇਲੇ ਦਾ ਫੁੱਲ", cat:"veggie", unit:"piece" },
  { id:"greenonion",   name:"Green Onion / Hara Pyaz",  emoji:"🌱", hi:"हरा प्याज़", pa:"ਹਰਾ ਪਿਆਜ਼", cat:"veggie", unit:"bunch" },
  { id:"curryleaf",    name:"Curry Leaf / Kadi Patta",  emoji:"🌿", hi:"कढ़ी पत्ता", pa:"ਕੜੀ ਪੱਤਾ", cat:"veggie", unit:"bunch" },
  { id:"kakdi",        name:"Cucumis / Kakdi",          emoji:"🥒", hi:"ककड़ी", pa:"ਕਕੜੀ", cat:"veggie", unit:"kg" },
  { id:"redcabbage",   name:"Red Cabbage",              emoji:"🟣", hi:"लाल पत्तागोभी", pa:"ਲਾਲ ਗੋਭੀ", cat:"veggie", unit:"piece" },
  { id:"whitebrinjal", name:"White Eggplant",           emoji:"⬜", hi:"सफ़ेद बैंगन", pa:"ਚਿੱਟਾ ਬੈਂਗਣ", cat:"veggie", unit:"kg" },
  { id:"amla",         name:"Indian Gooseberry / Amla", emoji:"🟢", hi:"आंवला", pa:"ਆਂਵਲਾ", cat:"fruit", unit:"kg" },
  { id:"bakla",        name:"Fava Beans / Bakla",       emoji:"🫛", hi:"बाकला", pa:"ਬਾਕਲਾ", cat:"veggie", unit:"kg" },
  { id:"hathichak",    name:"Artichoke / Hathi Chak",   emoji:"🟢", hi:"हाथी चक", pa:"ਹਾਥੀ ਚੱਕ", cat:"veggie", unit:"kg" },
  { id:"karonda",      name:"Natal Plum / Karonda",     emoji:"🔴", hi:"करोंदा", pa:"ਕਰੌਂਦਾ", cat:"veggie", unit:"kg" },
  { id:"kachri",       name:"Mouse Melon / Kachri",     emoji:"🟡", hi:"कचरी", pa:"ਕਚਰੀ", cat:"veggie", unit:"kg" },
];


const QUICK_RATES = [10,15,20,25,30,40,50,60,70,80,100,120,140,160,180,200,250,300];
const EMOJIS = ["🍎","🥭","🍌","🍊","🍈","🍒","🍉","🍇","🍐","❤️","🫐","🍅","🥔","🧅","🥦","🥒","🥕","🌶️","🥬","🍆","🫑","🫘","🫛","🌽","🧄"];
const UNITS  = ["kg","g","piece","dozen","bunch","packet","500g","250g","litre"];

// Extra keyword → emoji map for items not present in DEFAULT_ITEMS (used for on-the-fly
// item creation while a vendor is building a bill — see guessItemEmoji below).
const EXTRA_EMOJI_MAP = [
  ["custard apple",{emoji:"🍏",cat:"fruit",unit:"kg"}],  ["sitafal",{emoji:"🍏",cat:"fruit",unit:"kg"}],
  ["jackfruit",{emoji:"🍈",cat:"veggie",unit:"kg"}],      ["kathal",{emoji:"🍈",cat:"veggie",unit:"kg"}],
  ["amla",{emoji:"🟢",cat:"fruit",unit:"kg"}],            ["gooseberry",{emoji:"🟢",cat:"fruit",unit:"kg"}],
  ["moong",{emoji:"🫘",cat:"grocery",unit:"kg"}],         ["urad",{emoji:"🫘",cat:"grocery",unit:"kg"}],
  ["masoor",{emoji:"🫘",cat:"grocery",unit:"kg"}],        ["arhar",{emoji:"🫘",cat:"grocery",unit:"kg"}],
  ["toor",{emoji:"🫘",cat:"grocery",unit:"kg"}],          ["elaichi",{emoji:"🟢",cat:"grocery",unit:"kg"}],
  ["cardamom",{emoji:"🟢",cat:"grocery",unit:"kg"}],      ["laung",{emoji:"🟤",cat:"grocery",unit:"kg"}],
  ["clove",{emoji:"🟤",cat:"grocery",unit:"kg"}],         ["saunf",{emoji:"🌿",cat:"grocery",unit:"kg"}],
  ["fennel",{emoji:"🌿",cat:"grocery",unit:"kg"}],        ["hing",{emoji:"🟡",cat:"grocery",unit:"g"}],
  ["asafoetida",{emoji:"🟡",cat:"grocery",unit:"g"}],     ["cold drink",{emoji:"🥤",cat:"grocery",unit:"piece"}],
  ["soft drink",{emoji:"🥤",cat:"grocery",unit:"piece"}], ["water bottle",{emoji:"💧",cat:"grocery",unit:"piece"}],
  ["mineral water",{emoji:"💧",cat:"grocery",unit:"piece"}], ["ice cream",{emoji:"🍦",cat:"grocery",unit:"piece"}],
  ["cheese",{emoji:"🧀",cat:"grocery",unit:"packet"}],    ["juice",{emoji:"🧃",cat:"grocery",unit:"litre"}],
  ["chicken",{emoji:"🍗",cat:"grocery",unit:"kg"}],       ["mutton",{emoji:"🍖",cat:"grocery",unit:"kg"}],
  ["fish",{emoji:"🐟",cat:"grocery",unit:"kg"}],          ["prawn",{emoji:"🦐",cat:"grocery",unit:"kg"}],
  ["papad",{emoji:"🫓",cat:"grocery",unit:"packet"}],     ["pickle",{emoji:"🫙",cat:"grocery",unit:"kg"}],
  ["achar",{emoji:"🫙",cat:"grocery",unit:"kg"}],         ["jam",{emoji:"🍯",cat:"grocery",unit:"piece"}],
  ["ketchup",{emoji:"🍅",cat:"grocery",unit:"piece"}],    ["sauce",{emoji:"🍅",cat:"grocery",unit:"piece"}],
  ["vinegar",{emoji:"🍶",cat:"grocery",unit:"litre"}],    ["candle",{emoji:"🕯️",cat:"grocery",unit:"piece"}],
  ["tissue",{emoji:"🧻",cat:"grocery",unit:"packet"}],    ["shaving",{emoji:"🪒",cat:"grocery",unit:"piece"}],
  ["toothbrush",{emoji:"🪥",cat:"grocery",unit:"piece"}], ["diaper",{emoji:"🍼",cat:"grocery",unit:"packet"}],
  ["battery",{emoji:"🔋",cat:"grocery",unit:"piece"}],    ["bulb",{emoji:"💡",cat:"grocery",unit:"piece"}],
  ["curd",{emoji:"🥛",cat:"grocery",unit:"kg"}],          ["lassi",{emoji:"🥤",cat:"grocery",unit:"litre"}],
  ["sitaphal",{emoji:"🍏",cat:"fruit",unit:"kg"}],        ["chikoo",{emoji:"🟤",cat:"fruit",unit:"kg"}],
  ["sapota",{emoji:"🟤",cat:"fruit",unit:"kg"}],          ["avocado",{emoji:"🥑",cat:"fruit",unit:"piece"}],
  ["bottlegourd",{emoji:"🥒",cat:"veggie",unit:"piece"}], ["ridgegourd",{emoji:"🥒",cat:"veggie",unit:"kg"}],
  ["torai",{emoji:"🥒",cat:"veggie",unit:"kg"}],          ["capsicum",{emoji:"🫑",cat:"veggie",unit:"kg"}],
  ["shimla",{emoji:"🫑",cat:"veggie",unit:"kg"}],
  ["lotus",{emoji:"🪷",cat:"veggie",unit:"kg"}],          ["kamal",{emoji:"🪷",cat:"veggie",unit:"kg"}],
  ["kamal kakdi",{emoji:"🪷",cat:"veggie",unit:"kg"}],    ["lotus stem",{emoji:"🪷",cat:"veggie",unit:"kg"}],
  ["lotus root",{emoji:"🪷",cat:"veggie",unit:"kg"}],     ["bhindi",{emoji:"🟢",cat:"veggie",unit:"kg"}],
  ["okra",{emoji:"🟢",cat:"veggie",unit:"kg"}],            ["lady finger",{emoji:"🟢",cat:"veggie",unit:"kg"}],
  ["gwar",{emoji:"🟢",cat:"veggie",unit:"kg"}],            ["cluster bean",{emoji:"🟢",cat:"veggie",unit:"kg"}],
  ["chichinda",{emoji:"🟢",cat:"veggie",unit:"kg"}],      ["snake gourd",{emoji:"🟢",cat:"veggie",unit:"kg"}],
  ["petha",{emoji:"🟢",cat:"veggie",unit:"kg"}],          ["ash gourd",{emoji:"🟢",cat:"veggie",unit:"kg"}],
  ["bathhua",{emoji:"🌿",cat:"veggie",unit:"bunch"}],     ["sarson",{emoji:"🥬",cat:"veggie",unit:"bunch"}],
  ["kundru",{emoji:"🟢",cat:"veggie",unit:"kg"}],         ["jimikand",{emoji:"🥔",cat:"veggie",unit:"kg"}],
  ["kachri",{emoji:"🟡",cat:"veggie",unit:"kg"}],         ["karonda",{emoji:"🔴",cat:"veggie",unit:"kg"}],
];

// Guess the best emoji/category/unit for a freely-typed item name. Vendors can search for
// an item while building a bill; if it isn't in their catalog yet, this powers the
// "add on the fly" quick-add card so they never have to pick an emoji manually.
function guessItemEmoji(query){
  const q = (query||"").trim().toLowerCase();
  if(!q) return {emoji:"🧺", cat:"grocery", unit:"kg"};
  // 1) Exact match against a name-part / hi / pa in the full master catalog
  for(const it of DEFAULT_ITEMS){
    const parts = it.name.toLowerCase().split("/").map(s=>s.trim());
    if(parts.includes(q) || it.hi===query.trim() || it.pa===query.trim()){
      return {emoji:it.emoji, cat:it.cat, unit:it.unit};
    }
  }
  // 2) Substring match either direction against the master catalog
  for(const it of DEFAULT_ITEMS){
    const parts = it.name.toLowerCase().split("/").map(s=>s.trim());
    if(parts.some(p=>p.length>1 && (p.includes(q) || q.includes(p)))){
      return {emoji:it.emoji, cat:it.cat, unit:it.unit};
    }
  }
  // 3) Extra keyword map for common items outside the default catalog
  for(const [key,val] of EXTRA_EMOJI_MAP){
    if(q.includes(key)) return val;
  }
  // 4) Fallback — generic basket emoji, grocery category
  return {emoji:"🧺", cat:"grocery", unit:"kg"};
}

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
function shopDisplayName(name, hi, pa, lang){
  if(lang==="hi" && hi) return hi;
  if(lang==="pa" && pa) return pa;
  return name;
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
  const [shopNameHi,   setShopNameHi]  = useState(""); // dukan ka naam Hindi mein
  const [shopNamePa,   setShopNamePa]  = useState(""); // dukan da naam Punjabi vich
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
  const [billSearch,   setBillSearch]  = useState("");   // search box inside Bill tab
  const [quickRate,    setQuickRate]   = useState("");   // rate typed for a quick-add / quick-set item
  const [quickEmoji,   setQuickEmoji]  = useState(null); // manual emoji override for quick-add (null = auto-guess)
  const [quickEmojiPick,setQuickEmojiPick]=useState(false);
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
  const [vendorOwnWA,  setVendorOwnWA] = useState("");
  const [vendorPhotoUrl,setVendorPhotoUrl]=useState(""); // saved photo URL
  const [photoUploading,setPhotoUploading]=useState(false);
  const [broadcastList,  setBroadcastList]  = useState([]); // [{name,number}]
  const [broadcastInput, setBroadcastInput] = useState({name:"",number:""});
  const [showBroadcast,  setShowBroadcast]  = useState(false);
  const [vendorArea,   setVendorArea]  = useState("");   // vendor's area text
  const [vendorLat,    setVendorLat]   = useState(null); // vendor GPS lat
  const [vendorLng,    setVendorLng]   = useState(null); // vendor GPS lng
  const [locLoading,   setLocLoading]  = useState(false);// GPS fetching
  const [custLat,      setCustLat]     = useState(null); // customer GPS lat
  const [custLng,      setCustLng]     = useState(null); // customer GPS lng
  const [locationFilter,setLocationFilter]=useState("all"); // "all" | "near"    // vendor's own WhatsApp for customer directory
  const [selectedVendor,setSelectedVendor]=useState(null); // vendor customer picked from directory
  const [selectedVendorName,setSelectedVendorName]=useState(""); // persisted shop name shown even before directory re-fetch
  const [vendorDirectory,setVendorDirectory]=useState([]);
  const [placesResults, setPlacesResults] = useState([]); // OSM/Google results
  const [locationSearch,setLocationSearch]= useState("");  // typed location query
  const [dirLoading,   setDirLoading]  = useState(false);
  const [dirError,     setDirError]    = useState("");
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
  const [compareItems, setCompareItems]= useState([]);   // items available for comparison
  const [compareItem,  setCompareItem] = useState(null); // selected item to compare
  const [compareRates, setCompareRates]= useState([]);   // rates from all vendors
  const [compareLoading,setCompareLoading]=useState(false);
  const [compareError, setCompareError]= useState("");
  const [custOwnName,  setCustOwnName] = useState("");
  const [custArea,     setCustArea]    = useState(""); // customer's area from GPS
  const [custGpsLat,   setCustGpsLat]  = useState(null);
  const [custGpsLng,   setCustGpsLng]  = useState(null);
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

  // ── APP INSTALL (PWA — "download like Play Store") ──
  const [installPrompt, setInstallPrompt] = useState(null); // captured beforeinstallprompt event (Android/Chrome/Edge)
  const [isInstalled,   setIsInstalled]   = useState(false);
  const [showIosHelp,   setShowIosHelp]   = useState(false);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  useEffect(()=>{
    const already = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if(already || navigator.standalone) setIsInstalled(true);
    const onBeforeInstall = (e)=>{ e.preventDefault(); setInstallPrompt(e); };
    const onInstalled = ()=>{ setIsInstalled(true); setInstallPrompt(null); notify("✅ App install ho gaya!"); };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return ()=>{
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function installApp(){
    if(installPrompt){
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if(choice.outcome === 'accepted') setIsInstalled(true);
      setInstallPrompt(null);
      return;
    }
    if(isIos){ setShowIosHelp(true); return; }
    notify("Browser ke menu se 'Add to Home Screen' / 'Install App' chuno", "error");
  }

  function IosInstallHelp(){
    if(!showIosHelp) return null;
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:2000}} onClick={()=>setShowIosHelp(false)}>
        <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:"22px 22px 0 0",padding:"22px 20px 28px",width:"100%",maxWidth:420,boxShadow:"0 -4px 24px rgba(0,0,0,0.25)"}}>
          <div style={{fontWeight:900,fontSize:17,color:C.navy,marginBottom:14}}>📲 iPhone par Install karo</div>
          <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:12}}>
            <div style={{fontSize:22}}>1️⃣</div>
            <div style={{fontSize:14,color:C.dgray}}>Safari mein neeche <b>Share</b> icon (⬆️ box se arrow) dabao</div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:12}}>
            <div style={{fontSize:22}}>2️⃣</div>
            <div style={{fontSize:14,color:C.dgray}}><b>"Add to Home Screen"</b> chuno</div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:18}}>
            <div style={{fontSize:22}}>3️⃣</div>
            <div style={{fontSize:14,color:C.dgray}}><b>"Add"</b> dabao — FreshBill ka icon home screen par aa jayega, bilkul app ki tarah!</div>
          </div>
          <button onClick={()=>setShowIosHelp(false)}
            style={{width:"100%",padding:"13px 0",borderRadius:14,border:"none",background:C.green,color:"white",fontWeight:800,fontSize:15,cursor:"pointer"}}>
            Samajh gaya
          </button>
        </div>
      </div>
    );
  }

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
        if(d.shopNameHi)setShopNameHi(d.shopNameHi);
        if(d.shopNamePa)setShopNamePa(d.shopNamePa);
        if(d.appLang)   setAppLang(d.appLang);
        if(d.shopSetup) setShopSetup(d.shopSetup);
        if(d.vendorOwnWA)   setVendorOwnWA(d.vendorOwnWA);
        if(d.broadcastList) setBroadcastList(d.broadcastList);
        if(d.vendorPhotoUrl)setVendorPhotoUrl(d.vendorPhotoUrl);
        if(d.vendorArea)  setVendorArea(d.vendorArea);
        if(d.vendorLat)   setVendorLat(d.vendorLat);
        if(d.vendorLng)   setVendorLng(d.vendorLng);
        if(d.trialStart)setTrialStart(d.trialStart);
        if(d.paidMonth) setPaidMonth(d.paidMonth);
        // Role is NOT restored — picker shows on every app open
        if(d.custVendorWA) setCustVendorWA(d.custVendorWA);
        if(d.custOwnName)  setCustOwnName(d.custOwnName);
        if(d.custArea)     setCustArea(d.custArea);
        if(d.custGpsLat)   setCustGpsLat(d.custGpsLat);
        if(d.custGpsLng)   setCustGpsLng(d.custGpsLng);
        if(d.custSetup)    setCustSetup(d.custSetup);
        if(d.selectedVendorName){
          setSelectedVendorName(d.selectedVendorName);
          setSelectedVendor({ shop_name: d.selectedVendorName, vendor_wa: d.custVendorWA||"" });
        }
        // Ping Supabase with real name from storage (only if name is set)
        if(d.shopSetup && d.shopName && d.shopName!=="Mera Fruit & Sabzi Store"){
          sbPing(deviceId, d.shopName, d.trialStart, !!d.paidMonth, d.paidMonth||null, d.vendorOwnWA, d.vendorLat||null, d.vendorLng||null, d.vendorArea||null);
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
    save("fb-data-v2",{items,rates,bills,shopName,shopNameHi,shopNamePa,shopSetup,custSetup,trialStart,paidMonth,role,custVendorWA,custOwnName,custArea,custGpsLat,custGpsLng,appLang,vendorOwnWA,vendorPhotoUrl,broadcastList,vendorArea,vendorLat,vendorLng,selectedVendorName});
  },[items,rates,bills,shopName,shopNameHi,shopNamePa,shopSetup,custSetup,trialStart,paidMonth,role,custVendorWA,custOwnName,custArea,custGpsLat,custGpsLng,appLang,vendorOwnWA,vendorPhotoUrl,broadcastList,vendorArea,vendorLat,vendorLng,selectedVendorName,screen]);

  // ── RE-PING SUPABASE when shop name changes ──
  useEffect(()=>{
    if(!trialStart || !shopName || shopName==="Mera Fruit & Sabzi Store") return;
    const t = setTimeout(()=>{
      sbPing(deviceId, shopName, trialStart, !!paidMonth, paidMonth||null, vendorOwnWA, vendorLat||null, vendorLng||null, vendorArea||null);
    }, 1200);
    return ()=>clearTimeout(t);
  },[shopName, vendorOwnWA]);

  // ── RE-PING SUPABASE when customer name changes (includes location if available) ──
  useEffect(()=>{
    if(!custOwnName) return;
    const t = setTimeout(()=>{
      sbCustomerPing(deviceId, custOwnName, custVendorWA, custArea||null, custGpsLat||null, custGpsLng||null);
    }, 1200);
    return ()=>clearTimeout(t);
  },[custOwnName]);

  // ── AUTO-DETECT CUSTOMER LOCATION silently when they open the app ──
  useEffect(()=>{
    if(role!=="customer" || !custOwnName || custGpsLat) return; // skip if already have location
    (async()=>{
      try {
        const pos = await getBrowserLocation();
        setCustGpsLat(pos.lat); setCustGpsLng(pos.lng);
        const area = await reverseGeocode(pos.lat, pos.lng);
        if(area) setCustArea(area);
        sbCustomerPing(deviceId, custOwnName, custVendorWA, area||null, pos.lat, pos.lng);
      } catch {} // silent — don't bother user if they deny location
    })();
  },[role, custOwnName]);

  // ── AUTO-DETECT VENDOR LOCATION silently when they open the app ──
  useEffect(()=>{
    if(role!=="vendor" || !shopSetup || vendorLat) return; // skip if already have location
    (async()=>{
      try {
        const pos = await getBrowserLocation();
        setVendorLat(pos.lat); setVendorLng(pos.lng);
        const area = await reverseGeocode(pos.lat, pos.lng);
        if(area) setVendorArea(area);
        // Silently save to Supabase with location
        sbPing(deviceId, shopName, trialStart, !!paidMonth, paidMonth||null, vendorOwnWA, pos.lat, pos.lng, area||null);
      } catch {} // silent fail if GPS denied
    })();
  },[role, shopSetup]);


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
  function setRate(id, val){
    setRates(p=>({...p,[id]:val}));
    setActiveItem(null);
    setCustomRate("");
    // Sync to Supabase for rate comparison feature
    const item = items.find(i=>i.id===id);
    if(item) sbSyncRate(deviceId, item, val);
  }
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

  // Vendor searched for an item that already exists in their catalog but has no rate set yet —
  // set the rate right there and drop it straight into the bill, no tab-switching needed.
  function quickSetRateAndBill(item){
    if(!canUse){ setScreen("paywall"); return; }
    const rateVal = Number(quickRate);
    if(!rateVal || rateVal<=0){ notify("Pehle rate daalo","error"); return; }
    setRate(item.id, rateVal);
    setBillItems(p=>{ const ex=p.find(x=>x.id===item.id); if(ex) return p.map(x=>x.id===item.id?{...x,qty:x.qty+1}:x); return [...p,{...item,qty:1,rate:rateVal}]; });
    notify(`🛒 ${item.name.split("/")[0]} add!`);
    setBillSearch(""); setQuickRate(""); setQuickEmoji(null); setQuickEmojiPick(false);
  }

  // Vendor searched for a brand-new item that isn't in the catalog at all — create it on the
  // fly (auto-guessed emoji unless the vendor picked one manually), set its rate, and add it
  // straight into the bill being built. No separate "add item" step required.
  function quickAddAndBill(){
    if(!canUse){ setScreen("paywall"); return; }
    const name = billSearch.trim();
    if(!name) return;
    const rateVal = Number(quickRate);
    if(!rateVal || rateVal<=0){ notify("Pehle rate daalo","error"); return; }
    const guess = guessItemEmoji(name);
    const emoji = quickEmoji || guess.emoji;
    const id = "c_"+Date.now();
    const newItem = { id, name, emoji, cat: guess.cat, unit: guess.unit };
    setItems(p=>[...p, newItem]);
    setRates(p=>({...p,[id]:rateVal}));
    sbSyncRate(deviceId, newItem, rateVal);
    setBillItems(p=>[...p, {...newItem, qty:1, rate:rateVal}]);
    notify(`✅ ${name} naya item add ho gaya aur bill mein daal diya!`);
    setBillSearch(""); setQuickRate(""); setQuickEmoji(null); setQuickEmojiPick(false);
  }

  // ── CUSTOMER LIST ──
  function custToggle(item){
    setCustList(p=>{ const ex=p.find(x=>x.id===item.id); if(ex) return p.filter(x=>x.id!==item.id); return [...p,{...item,qty:1}]; });
  }
  function custSetQty(id,qty){ if(qty<=0){setCustList(p=>p.filter(x=>x.id!==id));return;} setCustList(p=>p.map(x=>x.id===id?{...x,qty:Math.round(qty*100)/100}:x)); }
  function custSendWA(){
    if(!custList.length){ notify("Pehle kuch items chuno!","error"); return; }
    const targetWA = selectedVendor?.vendor_wa || custVendorWA;
    let num = (targetWA||"").replace(/[^0-9]/g,"");
    if(num.length === 10){ num = "91" + num; } // add India code if missing
    if(!num){ notify("Dukandaar chuno ya number daalo!","error"); return; }
    let m=`🛒 *Meri Sabzi List*`;
    if(custOwnName) m+=`\n👤 ${custOwnName}`;
    if(selectedVendor) m+=`\n🏪 ${selectedVendor.shop_name}`;
    m+=`\n📅 ${todayStr()}\n\n`;
    custList.forEach((it,i)=>{ m+=`${i+1}. ${it.emoji} ${itemName(it, appLang)} — ${it.qty} ${it.unit}\n`; });
    m+=`\nBhaiya ye saman chahiye. Available hai? Rate aur total bata dena please.`;
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
            <div style={{display:"flex",gap:8,marginBottom:10}}>
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

            {/* Location search filter */}
            <input
              value={rateSearch}
              onChange={e=>setRateSearch(e.target.value)}
              placeholder="📍 Location filter: Delhi, Chandigarh Sector 12..."
              style={{width:"100%",padding:"9px 12px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:13,boxSizing:"border-box",outline:"none",marginBottom:12}}/>

            {/* VENDORS TAB */}
            {dashTab==="vendors" && (<>
              {vendorList.length===0 && !vendorLoading && (
                <div style={{textAlign:"center",color:C.gray,padding:"16px 0",fontSize:13}}>
                  Refresh dabao — sab vendors ki list aayegi
                </div>
              )}
              {vendorList.filter(v=>!rateSearch.trim()||(v.area||"").toLowerCase().includes(rateSearch.toLowerCase())||(v.shop_name||"").toLowerCase().includes(rateSearch.toLowerCase())).map((v)=>{
                const diffH = Math.floor((new Date()-new Date(v.last_seen))/3600000);
                const when = diffH<1?"Just now":diffH<24?`${diffH}h ago`:`${Math.floor(diffH/24)}d ago`;
                const isActive = diffH < 48;
                const mapsUrl = v.lat && v.lng ? `https://www.google.com/maps?q=${v.lat},${v.lng}` : v.area ? `https://www.google.com/maps/search/${encodeURIComponent(v.area)}` : null;
                return (
                  <div key={v.device_id} style={{borderBottom:`1px solid ${C.lgray}`,padding:"10px 0",display:"flex",gap:10,alignItems:"flex-start"}}>
                    {/* Photo thumbnail */}
                    <div style={{width:42,height:42,borderRadius:8,overflow:"hidden",background:C.lgray,flexShrink:0}}>
                      {v.photo_url
                        ? <img src={v.photo_url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                        : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🏪</div>}
                    </div>
                    <div style={{flex:1}}>
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
                    {(v.area || v.lat) && (
                      <div style={{marginTop:4,display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:11,color:C.green}}>📍 {v.area||"GPS saved"}</span>
                        {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer"
                          style={{fontSize:10,background:C.lgreen,color:C.green,padding:"1px 7px",borderRadius:20,fontWeight:700,textDecoration:"none"}}>
                          Map mein dekho ›
                        </a>}
                      </div>
                    )}
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
              {customerList.filter(c=>!rateSearch.trim()||(c.area||"").toLowerCase().includes(rateSearch.toLowerCase())||(c.cust_name||"").toLowerCase().includes(rateSearch.toLowerCase())).map((c)=>{
                const diffH = Math.floor((new Date()-new Date(c.last_seen))/3600000);
                const when = diffH<1?"Just now":diffH<24?`${diffH}h ago`:`${Math.floor(diffH/24)}d ago`;
                const isActive = diffH < 48;
                const mapsUrl = c.lat && c.lng ? `https://www.google.com/maps?q=${c.lat},${c.lng}` : c.area ? `https://www.google.com/maps/search/${encodeURIComponent(c.area)}` : null;
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
                    {(c.area || c.lat) && (
                      <div style={{marginTop:4,display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:11,color:C.green}}>📍 {c.area||"GPS saved"}</span>
                        {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer"
                          style={{fontSize:10,background:C.lgreen,color:C.green,padding:"1px 7px",borderRadius:20,fontWeight:700,textDecoration:"none"}}>
                          Map mein dekho ›
                        </a>}
                      </div>
                    )}
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
            <button onClick={async()=>{
              const shareData={ title:"FreshBill — Sabzi App", text:"FreshBill: Fruit & Sabzi ka smart app! Vendors ke rates dekho, list banao, WhatsApp par order karo.", url:"https://freshbill-delta.vercel.app" };
              if(navigator.share){ try{ await navigator.share(shareData); } catch{} }
              else{ try{ await navigator.clipboard.writeText("FreshBill app download karo: https://freshbill-delta.vercel.app"); notify("✅ Link copy ho gaya!"); } catch{} }
            }} style={{marginTop:10,padding:"10px 24px",borderRadius:12,border:`1.5px solid ${C.green}`,background:"#F0FFF4",color:C.green,fontWeight:700,fontSize:13,cursor:"pointer"}}>
              🔗 App Share Karo
            </button>
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
      <button onClick={()=>{setRole("vendor");setScreen("home");setTab("rates");setBillItems([]);setCustName("");setCustPhone("");setEditingId(null);}}
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

      {/* Install button — always visible */}
      <button onClick={installApp}
        style={{width:"100%",maxWidth:340,marginTop:14,padding:"14px 20px",borderRadius:16,border:isInstalled?"2px solid rgba(255,255,255,0.3)":"none",background:isInstalled?"rgba(255,255,255,0.1)":C.gold,color:"white",fontWeight:900,fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:isInstalled?"none":"0 6px 20px rgba(245,158,11,0.4)"}}>
        {isInstalled ? "✅ App Install Ho Chuka Hai" : "📲 App Install Karo — Free"}
      </button>

      <IosInstallHelp/>

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

    // Build display list from either OSM+registered merge OR registered-only
    const q = custSearch.trim().toLowerCase();
    let displayList = placesResults.length > 0
      ? placesResults
      : vendorDirectory.map(v=>({
          osm_id:"reg_"+v.device_id, name:v.shop_name||"Unknown",
          lat:v.lat, lng:v.lng, address:v.area||null, phone:v.vendor_wa,
          registered:true, vendor:v
        }));

    // Near Me filter (only when using registered-only list)
    if(placesResults.length===0 && locationFilter==="near" && custLat && custLng){
      displayList = displayList
        .filter(v=>v.lat&&v.lng)
        .map(v=>({...v, _dist:distanceKm(custLat,custLng,v.lat,v.lng)}))
        .sort((a,b)=>a._dist-b._dist).slice(0,20);
    }

    // Text search across name + address
    if(q) displayList = displayList.filter(v=>(v.name||"").toLowerCase().includes(q)||(v.address||"").toLowerCase().includes(q)||(v.vendor?.shop_name||"").toLowerCase().includes(q));

    const registeredCount = displayList.filter(x=>x.registered).length;
    const unregisteredCount = displayList.filter(x=>!x.registered).length;

    return (
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Segoe UI,sans-serif",paddingBottom:24}}>
        {toast && <Toast {...toast}/>}
        <div style={{background:`linear-gradient(135deg,${C.navy},${C.green})`,padding:"16px",color:"white"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:"white",fontSize:22,cursor:"pointer"}}>←</button>
            <div>
              <div style={{fontWeight:900,fontSize:18}}>🏪 Dukandaar Chuno</div>
              <div style={{fontSize:11,opacity:0.8}}>Registered + sab local vendors</div>
            </div>
          </div>

          {/* Location Search Bar */}
          <div style={{display:"flex",gap:8}}>
            <input value={locationSearch} onChange={e=>setLocationSearch(e.target.value)}
              onKeyDown={async e=>{
                if(e.key!=="Enter"||!locationSearch.trim()) return;
                setDirLoading(true); setDirError(""); setPlacesResults([]);
                try {
                  const geo = await geocodeArea(locationSearch);
                  if(!geo){ setDirError(`"${locationSearch}" nahi mila`); setDirLoading(false); return; }
                  const [osmPlaces, regVendors] = await Promise.all([
                    fetchOsmVendors(geo.lat, geo.lng),
                    sbFetchDirectory()
                  ]);
                  const merged = mergeVendorResults(osmPlaces, Array.isArray(regVendors)?regVendors:[]);
                  setPlacesResults(merged);
                  notify(`📍 ${geo.label}: ${merged.length} vendors mile`);
                } catch(e){ setDirError(e.message||"Search failed"); }
                setDirLoading(false);
              }}
              placeholder="📍 Area type karo, Enter dabao — Lajpat Nagar, Chandigarh Sector 12..."
              style={{flex:1,padding:"11px 14px",borderRadius:12,border:"none",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
            <button onClick={async()=>{
              if(!locationSearch.trim()){ notify("Area ka naam type karo","error"); return; }
              setDirLoading(true); setDirError(""); setPlacesResults([]);
              try {
                const geo = await geocodeArea(locationSearch);
                if(!geo){ setDirError(`"${locationSearch}" nahi mila`); setDirLoading(false); return; }
                const [osmPlaces, regVendors] = await Promise.all([
                  fetchOsmVendors(geo.lat, geo.lng),
                  sbFetchDirectory()
                ]);
                const merged = mergeVendorResults(osmPlaces, Array.isArray(regVendors)?regVendors:[]);
                setPlacesResults(merged);
                notify(`📍 ${geo.label}: ${merged.length} vendors mile`);
              } catch(e){ setDirError(e.message||"Search failed"); }
              setDirLoading(false);
            }} style={{padding:"11px 16px",borderRadius:12,border:"none",background:"rgba(255,255,255,0.25)",color:"white",fontWeight:800,fontSize:14,cursor:"pointer",whiteSpace:"nowrap"}}>
              {dirLoading?"⏳":"🔍"}
            </button>
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.65)",marginTop:6}}>
            jaise: "Lajpat Nagar Delhi", "Sector 12 Chandigarh", "Punjabi Bagh"
          </div>
        </div>

        <div style={{padding:16}}>

          {/* Quick filter: Near Me (when no location search) */}
          {placesResults.length===0 && (
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              <button onClick={()=>{setLocationFilter("all");setCustLat(null);setCustLng(null);setPlacesResults([]);}}
                style={{flex:1,padding:"9px 0",borderRadius:10,border:"none",background:locationFilter==="all"?C.navy:"#E8F5E9",color:locationFilter==="all"?"white":C.navy,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                🏪 Registered Vendors
              </button>
              <button onClick={async()=>{
                if(custLat&&locationFilter==="near"){ setLocationFilter("all"); setCustLat(null); setCustLng(null); return; }
                try {
                  const pos = await getBrowserLocation(); setCustLat(pos.lat); setCustLng(pos.lng); setLocationFilter("near");
                  notify("✅ Aapke paas ke vendors dikh rahe hain");
                } catch(e){ notify(e.message,"error"); }
              }} style={{flex:1,padding:"9px 0",borderRadius:10,border:"none",background:locationFilter==="near"?C.green:"#E8F5E9",color:locationFilter==="near"?"white":C.navy,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                {locationFilter==="near"?"📍 Near Me ✓":"📍 Near Me"}
              </button>
              <button onClick={async()=>{
                setDirLoading(true); setDirError("");
                const data=await sbFetchDirectory();
                if(data&&data.error){ setDirError(data.error); setVendorDirectory([]); }
                else setVendorDirectory(Array.isArray(data)?data:[]);
                setDirLoading(false);
              }} style={{padding:"9px 14px",borderRadius:10,border:`1.5px solid ${C.green}`,background:"white",color:C.green,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                {dirLoading?"⏳":"🔄"}
              </button>
            </div>
          )}

          {/* Results count + legend */}
          {displayList.length>0 && (
            <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
              {registeredCount>0 && <div style={{fontSize:12,background:C.lgreen,color:C.green,padding:"3px 10px",borderRadius:20,fontWeight:700}}>✅ {registeredCount} App mein registered</div>}
              {unregisteredCount>0 && <div style={{fontSize:12,background:"#F3F4F6",color:"#6B7280",padding:"3px 10px",borderRadius:20,fontWeight:700}}>⚪ {unregisteredCount} Registered nahi</div>}
            </div>
          )}

          {/* Name search within results */}
          {displayList.length>0 && (
            <input value={custSearch} onChange={e=>setCustSearch(e.target.value)} placeholder="🔍 Naam se filter karo..."
              style={{width:"100%",marginBottom:12,padding:"9px 12px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
          )}

          {dirError && <div style={{background:"#FEE2E2",border:"1.5px solid #DC2626",borderRadius:12,padding:"12px 14px",marginBottom:14,fontSize:12,color:"#991B1B"}}>{dirError}</div>}

          {displayList.length===0 && !dirLoading && !dirError && (
            <div style={{textAlign:"center",color:C.gray,padding:"40px 0"}}>
              <div style={{fontSize:40}}>📍</div>
              <div style={{marginTop:8,fontWeight:600,fontSize:14}}>Location type karo upar</div>
              <div style={{fontSize:12,marginTop:4}}>App ke registered vendors + sab local vendors dikhenge</div>
            </div>
          )}

          {displayList.map((v,i)=>{
            const isReg = v.registered;
            const vName = isReg && v.vendor
              ? shopDisplayName(v.vendor.shop_name||v.name, v.vendor.shop_name_hi||"", v.vendor.shop_name_pa||"", appLang)
              : v.name;
            const dist = v._dist?(v._dist<1?`${Math.round(v._dist*1000)}m`:`${v._dist.toFixed(1)}km`):null;
            const waNum = isReg ? v.vendor?.vendor_wa : v.phone;

            return (
              <div key={v.osm_id||i}
                onClick={()=>{
                  if(!isReg){ notify("Yeh vendor abhi app mein register nahi hai — unhe FreshBill download karao!","error"); return; }
                  setSelectedVendor(v.vendor);
                  setSelectedVendorName(v.vendor?.shop_name||v.name);
                  setCustVendorWA(v.vendor?.vendor_wa||"");
                  setScreen("home");
                  notify(`✅ ${vName} select ho gaya`);
                }}
                style={{background:"white",borderRadius:14,padding:"12px 14px",marginBottom:10,boxShadow:"0 1px 8px rgba(0,0,0,0.06)",cursor:isReg?"pointer":"default",display:"flex",gap:12,alignItems:"center",opacity:isReg?1:0.85,border:`1.5px solid ${isReg?C.lgreen:C.lgray}`}}>

                {/* Photo or placeholder */}
                <div style={{width:50,height:50,borderRadius:12,overflow:"hidden",background:isReg?C.lgreen:"#F3F4F6",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {isReg && v.vendor?.photo_url
                    ? <img src={v.vendor.photo_url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                    : <div style={{fontSize:22}}>{isReg?"🏪":"📍"}</div>}
                </div>

                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <div style={{fontWeight:700,fontSize:14,color:C.navy}}>{vName}</div>
                    {isReg
                      ? <div style={{fontSize:10,background:C.green,color:"white",padding:"1px 7px",borderRadius:20,fontWeight:700}}>✅ FreshBill</div>
                      : <div style={{fontSize:10,background:"#E5E7EB",color:"#6B7280",padding:"1px 7px",borderRadius:20,fontWeight:600}}>⚪ Registered nahi</div>}
                  </div>
                  {v.address && <div style={{fontSize:11,color:C.gray,marginTop:2}}>📍 {v.address}</div>}
                  <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap"}}>
                    {dist && <div style={{fontSize:10,background:C.lgreen,color:C.green,padding:"1px 7px",borderRadius:20,fontWeight:700}}>📍 {dist}</div>}
                    {waNum && <div style={{fontSize:10,color:C.gray}}>📞 {waNum}</div>}
                    {v.type && <div style={{fontSize:10,color:C.gray,textTransform:"capitalize"}}>🛒 {v.type}</div>}
                  </div>
                </div>

                {isReg
                  ? <div style={{fontSize:18,color:C.green}}>›</div>
                  : <button onClick={e=>{ e.stopPropagation();
                      const msg=`Namaste! Aapko FreshBill app download karna chahiye — apni dukan wahan register karo aur customers seedha aapse order kar sakenge.\n\nDownload karo: https://freshbill-delta.vercel.app`;
                      const num=(waNum||"").replace(/[^0-9]/g,"");
                      if(num.length>=10) window.open(`https://wa.me/${num.length===10?"91"+num:num}?text=${encodeURIComponent(msg)}`,"_blank");
                      else notify("Is vendor ka number nahi mila","error");
                    }} style={{background:C.green,border:"none",color:"white",borderRadius:10,padding:"6px 8px",fontSize:10,fontWeight:700,cursor:"pointer",flexShrink:0,whiteSpace:"nowrap"}}>
                    App Invite Karo
                  </button>}
              </div>
            );
          })}

          {placesResults.length>0 && (
            <button onClick={()=>{setPlacesResults([]);setLocationSearch("");setDirError("");}}
              style={{width:"100%",padding:"11px 0",borderRadius:12,border:`1.5px dashed ${C.lgray}`,background:"white",color:C.gray,fontWeight:600,fontSize:13,cursor:"pointer",marginTop:8}}>
              ✕ Search clear karo — sirf registered vendors dekho
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── RATE COMPARISON SCREEN ──
  if(role==="customer" && screen==="compareRates"){
    return (
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Segoe UI,sans-serif",paddingBottom:32}}>
        {toast && <Toast {...toast}/>}
        <div style={{background:`linear-gradient(135deg,${C.navy},${C.green})`,padding:"16px",color:"white"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:"white",fontSize:22,cursor:"pointer"}}>←</button>
            <div>
              <div style={{fontWeight:900,fontSize:18}}>📊 Rate Compare Karo</div>
              <div style={{fontSize:12,opacity:0.8}}>Ek item chuno — sab vendors ke rates dekho</div>
            </div>
          </div>
        </div>

        <div style={{padding:16}}>
          {/* Load available items button */}
          {compareItems.length===0 && (
            <button onClick={async()=>{
              setCompareLoading(true); setCompareError("");
              const data = await sbFetchRatedItems();
              setCompareItems(Array.isArray(data)?data:[]);
              if(!Array.isArray(data)) setCompareError("Items load nahi hue, retry karo");
              setCompareLoading(false);
            }} style={{width:"100%",padding:"13px 0",borderRadius:14,border:`1.5px solid ${C.green}`,background:"white",color:C.green,fontWeight:700,fontSize:14,cursor:"pointer",marginBottom:14}}>
              {compareLoading?"⏳ Loading...":"🔄 Items Load Karo (Rates ke saath)"}
            </button>
          )}

          {compareError && <div style={{color:"#DC2626",fontSize:12,marginBottom:10}}>{compareError}</div>}

          {/* Item grid */}
          {compareItems.length>0 && !compareItem && (
            <>
              <div style={{fontWeight:700,color:C.navy,marginBottom:10}}>Item chuno jiska rate compare karna hai:</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
                {compareItems.map(it=>(
                  <button key={it.item_id} onClick={async()=>{
                    setCompareItem(it);
                    setCompareLoading(true); setCompareRates([]); setCompareError("");
                    const data = await sbFetchItemRates(it.item_id);
                    if(data && data.error){ setCompareError(data.error); setCompareLoading(false); return; }
                    setCompareRates(Array.isArray(data)?data:[]);
                    setCompareLoading(false);
                  }} style={{background:"white",border:`1.5px solid ${C.lgray}`,borderRadius:12,padding:"10px 4px",cursor:"pointer",textAlign:"center"}}>
                    <div style={{fontSize:24}}>{it.item_emoji}</div>
                    <div style={{fontSize:11,fontWeight:700,color:C.navy,marginTop:3,lineHeight:1.2}}>
                      {appLang==="hi"&&it.item_name_hi ? it.item_name_hi : appLang==="pa"&&it.item_name_pa ? it.item_name_pa : it.item_name}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Comparison results */}
          {compareItem && (
            <>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                <button onClick={()=>{setCompareItem(null);setCompareRates([]);}} style={{background:"none",border:"none",fontSize:20,cursor:"pointer"}}>←</button>
                <div style={{fontWeight:800,fontSize:16,color:C.navy}}>
                  {compareItem.item_emoji} {appLang==="hi"&&compareItem.item_name_hi ? compareItem.item_name_hi : appLang==="pa"&&compareItem.item_name_pa ? compareItem.item_name_pa : compareItem.item_name}
                </div>
                <div style={{fontSize:12,color:C.gray}}>per {compareItem.item_unit}</div>
              </div>

              {compareLoading && <div style={{textAlign:"center",color:C.gray,padding:"20px 0"}}>⏳ Rates dhundh rahe hain...</div>}

              {!compareLoading && compareRates.length===0 && (
                <div style={{textAlign:"center",color:C.gray,padding:"30px 0"}}>
                  <div style={{fontSize:36}}>😔</div>
                  <div style={{marginTop:8}}>Kisi vendor ne is item ka rate set nahi kiya abhi</div>
                </div>
              )}

              {compareRates.length>0 && (
                <>
                  {/* Best deal banner */}
                  <div style={{background:C.lgreen,borderRadius:14,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
                    <div style={{fontSize:24}}>🏆</div>
                    <div>
                      <div style={{fontSize:11,color:C.green,fontWeight:700}}>Sabse Sasta</div>
                      <div style={{fontWeight:900,fontSize:18,color:C.navy}}>₹{compareRates[0].rate}/{compareItem.item_unit}</div>
                      <div style={{fontSize:12,color:C.gray}}>{shopDisplayName(compareRates[0].vendor?.shop_name||"",compareRates[0].vendor?.shop_name_hi||"",compareRates[0].vendor?.shop_name_pa||"",appLang)||"Unknown Vendor"}</div>
                    </div>
                  </div>

                  {/* All rates sorted cheapest first */}
                  {compareRates.map((r,i)=>{
                    const vName = shopDisplayName(r.vendor?.shop_name||"",r.vendor?.shop_name_hi||"",r.vendor?.shop_name_pa||"",appLang)||"Unknown Vendor";
                    const diff = i===0 ? null : ((r.rate - compareRates[0].rate) / compareRates[0].rate * 100).toFixed(0);
                    return (
                      <div key={r.device_id+r.item_id} style={{background:"white",borderRadius:14,padding:"12px 14px",marginBottom:10,boxShadow:"0 1px 8px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",gap:12}}>
                        {/* Rank */}
                        <div style={{width:28,height:28,borderRadius:99,background:i===0?C.gold:C.lgray,color:i===0?"white":C.gray,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:13,flexShrink:0}}>
                          {i+1}
                        </div>
                        {/* Vendor photo */}
                        <div style={{width:42,height:42,borderRadius:10,overflow:"hidden",background:C.lgray,flexShrink:0}}>
                          {r.vendor?.photo_url
                            ? <img src={r.vendor.photo_url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                            : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🏪</div>}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:700,fontSize:14,color:C.navy}}>{vName}</div>
                          {r.vendor?.area && <div style={{fontSize:11,color:C.gray}}>📍 {r.vendor.area}</div>}
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontWeight:900,fontSize:18,color:i===0?C.green:C.navy}}>₹{r.rate}</div>
                          {diff && <div style={{fontSize:10,color:"#DC2626",fontWeight:700}}>+{diff}% mehenga</div>}
                        </div>
                        {/* Select this vendor */}
                        {r.vendor?.vendor_wa && <button onClick={()=>{
                          setSelectedVendor({...r.vendor, vendor_wa:r.vendor.vendor_wa});
                          setSelectedVendorName(r.vendor.shop_name||"");
                          setCustVendorWA(r.vendor.vendor_wa||"");
                          setScreen("home");
                          notify(`✅ ${vName} select ho gaya`);
                        }} style={{background:C.green,border:"none",color:"white",borderRadius:10,padding:"6px 10px",fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0}}>
                          Chuno
                        </button>}
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
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
        <IosInstallHelp/>

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
              {!isInstalled && (
                <button onClick={installApp}
                  style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",borderRadius:10,padding:"8px 10px",fontWeight:800,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                  📲 Install
                </button>
              )}
              <button onClick={()=>{setCompareItem(null);setCompareRates([]);setCompareItems([]);setScreen("compareRates");}}
                style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",borderRadius:10,padding:"8px 10px",fontWeight:800,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                📊 Compare
              </button>
              <button onClick={()=>setAppLang(appLang==="en"?"hi":appLang==="hi"?"pa":"en")}
                style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",borderRadius:10,padding:"8px 10px",fontWeight:800,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                {appLang==="en"?"🇬🇧 EN":appLang==="hi"?"🇮🇳 हिं":"☬ ਪੰ"}
              </button>
              <button onClick={()=>{setRole(null);setCustList([]);setScreen("home");}}
                style={{background:"rgba(255,255,255,0.2)",border:"none",color:"white",borderRadius:10,padding:"8px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>↩️</button>
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
            <button onClick={async()=>{
              const shareData={ title:"FreshBill — Sabzi App", text:"FreshBill: Fruit, Sabzi aur Grocery ka smart app! Vendors ke rates dekho, compare karo, WhatsApp par order karo.", url:"https://freshbill-delta.vercel.app" };
              if(navigator.share){ try{ await navigator.share(shareData); } catch{} }
              else{ try{ await navigator.clipboard.writeText("FreshBill app: https://freshbill-delta.vercel.app"); notify("Link copy ho gaya!"); } catch{} }
            }} style={{marginTop:10,padding:"9px 22px",borderRadius:12,border:`1.5px solid ${C.green}`,background:"#F0FFF4",color:C.green,fontWeight:700,fontSize:12,cursor:"pointer"}}>
              🔗 App Share Karo
            </button>
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
                <div><div style={{fontSize:11,color:C.gray}}>Dukandaar</div><div style={{fontWeight:700,fontSize:14,color:C.navy}}>🏪 {shopDisplayName(selectedVendor.shop_name, selectedVendor.shop_name_hi, selectedVendor.shop_name_pa, appLang)}</div></div>
                <div style={{fontSize:12,color:C.green,fontWeight:700}}>Badlo ›</div>
              </div>
            ) : (
              <button onClick={()=>setScreen("vendorPicker")}
                style={{width:"100%",marginTop:8,padding:"12px 0",borderRadius:10,border:`2px dashed ${C.green}`,background:"#F0FFF4",color:C.green,fontWeight:700,fontSize:14,cursor:"pointer"}}>
                🏪 Dukandaar Chuno
              </button>
            )}
            <input value={custVendorWA} onChange={e=>setCustVendorWA(e.target.value.replace(/[^0-9]/g,""))} placeholder="Ya WhatsApp number type karo (91...)" type="tel"
              style={{width:"100%",marginTop:8,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:13,boxSizing:"border-box",outline:"none"}}/>
            <button onClick={custSendWA}
              style={{width:"100%",marginTop:12,padding:"14px 0",borderRadius:14,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:16,cursor:"pointer"}}>
              📲 List Vendor Ko Bhejo
            </button>
            <div style={{textAlign:"center",fontSize:11,color:C.gray,margin:"10px 0"}}>— ya —</div>
            <button onClick={()=>{
              let num=(selectedVendor?.vendor_wa||custVendorWA||"").replace(/[^0-9]/g,"");
              if(num.length===10){ num="91"+num; }
              if(!num){ notify("Pehle dukandaar chuno!","error"); return; }
              // Opens WhatsApp chat directly — customer records & sends a voice note there (free, native)
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
              // Reset everything for this fresh vendor — no old rates/bills
              setRates({});
              setBills([]);
              setBillItems([]);
              setCustName("");
              setCustPhone("");
              sbPing(deviceId, name, trialStart, !!paidMonth, paidMonth||null, vendorOwnWA, vendorLat||null, vendorLng||null, vendorArea||null);
              notify("✅ Dukan save ho gayi! Ab rates set karo");
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
            const msg=`Namaste Harjit bhai!\n\nMaine FreshBill ke liye ₹30 pay kar diya.\n\nMera Device ID: *${deviceId}*\n\nPlease mujhe is mahine ka unlock code bhej dena. Screenshot attach kar raha/rahi hoon.`;
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
      <IosInstallHelp/>

      {/* Welcome banner for returning vendor */}
      {showWelcome && shopName && shopName!=="JK Technologies — Admin" && (
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:999,background:`linear-gradient(135deg,${C.navy},${C.green})`,color:"white",padding:"14px 20px",textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,0.2)"}}>
          <div style={{fontSize:20}}>👋 Wapas aaye {shopDisplayName(shopName, shopNameHi, shopNamePa, appLang)}!</div>
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
            {!isInstalled && (
              <button onClick={installApp}
                style={{background:"rgba(255,255,255,0.25)",border:"2px solid rgba(255,255,255,0.5)",color:"white",borderRadius:10,padding:"6px 11px",fontWeight:800,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}
                title="App ko phone mein install karo">
                📲 Install
              </button>
            )}
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
                const msg=`Namaste! Main FreshBill use kar raha/rahi hoon.\n\nMera Device ID: *${deviceId}*\nDukan: *${shopName}*\n\nPlease mujhe is mahine ka unlock code bhej dena.`;
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

          {/* Customer Directory Listing — vendor profile card */}
          <div style={{background:"white",borderRadius:16,padding:"14px 16px",marginBottom:14,boxShadow:"0 1px 8px rgba(0,0,0,0.06)"}}>
            <div style={{fontWeight:700,color:C.navy,fontSize:14,marginBottom:4}}>📸 Dukan Ki Photo</div>
            <div style={{fontSize:11,color:C.gray,marginBottom:10}}>Grahak ko aapki dukan dikhe directory mein</div>

            {/* Photo preview + upload */}
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:14}}>
              <div style={{width:72,height:72,borderRadius:14,overflow:"hidden",background:C.lgray,flexShrink:0,border:`2px solid ${C.lgray}`}}>
                {vendorPhotoUrl
                  ? <img src={vendorPhotoUrl} alt="shop" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                  : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>🏪</div>}
              </div>
              <div style={{flex:1}}>
                <label style={{display:"block",width:"100%",padding:"10px 0",borderRadius:10,border:`1.5px dashed ${C.green}`,background:"#F0FFF4",color:C.green,fontWeight:700,fontSize:13,cursor:"pointer",textAlign:"center"}}>
                  {photoUploading?"⏳ Upload ho raha hai...":"📷 Photo Chuno"}
                  <input type="file" accept="image/*" style={{display:"none"}} onChange={async(e)=>{
                    const file=e.target.files?.[0]; if(!file) return;
                    if(file.size > 2*1024*1024){ notify("Photo 2MB se chhoti honi chahiye","error"); return; }
                    setPhotoUploading(true);
                    const result = await sbUploadPhoto(deviceId, file);
                    if(result.error){ notify("❌ "+result.error,"error"); }
                    else {
                      setVendorPhotoUrl(result.url);
                      await sbSavePhotoUrl(deviceId, result.url);
                      notify("✅ Photo upload ho gayi!");
                    }
                    setPhotoUploading(false);
                  }}/>
                </label>
                {vendorPhotoUrl && <div style={{fontSize:10,color:C.gray,marginTop:4,textAlign:"center"}}>Photo saved ✓</div>}
              </div>
            </div>
            <div style={{fontWeight:700,color:C.navy,fontSize:14,marginBottom:4}}>🏪 Dukan Ka Naam — English, Hindi, Punjabi</div>
            <div style={{fontSize:11,color:C.gray,marginBottom:10}}>Grahak ki bhasha ke hisaab se naam dikhega</div>

            <div style={{fontSize:11,color:C.gray,marginBottom:4}}>🇬🇧 English / Hinglish naam</div>
            <input
              value={shopName}
              onChange={e=>setShopName(e.target.value)}
              placeholder="e.g. Ramesh Fruit & Sabzi Store"
              style={{width:"100%",padding:"11px 13px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,boxSizing:"border-box",outline:"none",marginBottom:10}}/>

            <div style={{fontSize:11,color:C.gray,marginBottom:4}}>🇮🇳 हिंदी में नाम</div>
            <input
              value={shopNameHi}
              onChange={e=>setShopNameHi(e.target.value)}
              placeholder="जैसे: रमेश फल और सब्ज़ी भंडार"
              style={{width:"100%",padding:"11px 13px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,boxSizing:"border-box",outline:"none",marginBottom:10}}/>

            <div style={{fontSize:11,color:C.gray,marginBottom:4}}>☬ ਪੰਜਾਬੀ ਵਿੱਚ ਨਾਮ</div>
            <input
              value={shopNamePa}
              onChange={e=>setShopNamePa(e.target.value)}
              placeholder="ਜਿਵੇਂ: ਰਮੇਸ਼ ਫਲ ਅਤੇ ਸਬਜ਼ੀ ਭੰਡਾਰ"
              style={{width:"100%",padding:"11px 13px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,boxSizing:"border-box",outline:"none",marginBottom:14}}/>

            <div style={{fontWeight:700,color:C.navy,fontSize:14,marginBottom:4}}>📍 Dukan Ki Location</div>
            <div style={{fontSize:11,color:C.gray,marginBottom:8}}>Grahak "Near Me" se aapko dhundh sakenge</div>
            <input
              value={vendorArea}
              onChange={e=>setVendorArea(e.target.value)}
              placeholder="Area ka naam (jaise: Lajpat Nagar, Punjabi Bagh)"
              style={{width:"100%",padding:"11px 13px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,boxSizing:"border-box",outline:"none",marginBottom:8}}/>
            <button onClick={async()=>{
              setLocLoading(true);
              try {
                const pos = await getBrowserLocation();
                setVendorLat(pos.lat); setVendorLng(pos.lng);
                const area = await reverseGeocode(pos.lat, pos.lng);
                if(area){ setVendorArea(area); notify(`📍 Location mili: ${area}`); }
                else { notify("📍 GPS mili, area naam nahi mila — aap type karo"); }
              } catch(e){ notify(e.message,"error"); }
              setLocLoading(false);
            }} style={{width:"100%",padding:"10px 0",borderRadius:10,border:`1.5px solid ${C.green}`,background:"#F0FFF4",color:C.green,fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:14}}>
              {locLoading?"📡 Dhundh raha hai...":"📡 GPS Se Location Lao (Auto)"}
            </button>
            {vendorLat && <div style={{fontSize:11,color:C.green,marginBottom:10}}>✅ GPS location saved: {vendorArea||"..."}</div>}

            <div style={{fontWeight:700,color:C.navy,fontSize:14,marginBottom:4}}>📞 Apna WhatsApp Number (Grahak ke liye)</div>
            <div style={{fontSize:11,color:C.gray,marginBottom:10}}>Yeh number Grahak ko "Dukandaar Chuno" list mein dikhega</div>
            <input
              value={vendorOwnWA}
              onChange={e=>setVendorOwnWA(e.target.value.replace(/[^0-9]/g,""))}
              placeholder="10 digit number (jaise 9773853112)"
              type="tel"
              style={{width:"100%",padding:"11px 13px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,boxSizing:"border-box",outline:"none",marginBottom:10}}/>
            <button onClick={async()=>{
              if(!shopName.trim()){ notify("Dukan ka naam (English) daalo","error"); return; }
              const clean = vendorOwnWA.replace(/[^0-9]/g,"");
              if(clean.length < 10){ notify("Sahi number daalo (10 digit)","error"); return; }
              const numToSave = clean.length === 10 ? "91" + clean : clean;
              const result = await sbPingVerified(deviceId, shopName, trialStart, !!paidMonth, paidMonth||null, numToSave, shopNameHi, shopNamePa, vendorArea||null, vendorLat||null, vendorLng||null, vendorPhotoUrl||null);
              if(result.ok){ notify("✅ Save ho gaya! Ab aap Grahak ki list mein dikhoge"); }
              else { notify("❌ Save fail: "+(result.error||"unknown"),"error"); }
            }} style={{width:"100%",padding:"12px 0",borderRadius:10,border:"none",background:`linear-gradient(135deg,${C.green},#25D366)`,color:"white",fontWeight:800,fontSize:14,cursor:"pointer"}}>
              💾 Sab Save Karo
            </button>
            {vendorOwnWA && vendorOwnWA.length>=10 && <div style={{fontSize:11,color:C.green,marginTop:8,fontWeight:600,textAlign:"center"}}>✅ Number set hai — Save dabana zaroori hai</div>}
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
              <div style={{fontWeight:700,color:C.navy,marginBottom:10}}>📢 Rates Bhejo</div>

              {/* Build message helper */}
              {(()=>{
                const buildMsg = ()=>{
                  let m=`🛒 *${shopName}*\n📅 Aaj ke Rates — ${todayStr()}\n\n`;
                  const f=ratedItems.filter(i=>i.cat==="fruit"); const v=ratedItems.filter(i=>i.cat==="veggie"); const g=ratedItems.filter(i=>i.cat==="grocery");
                  if(f.length){m+="*Fruits / Phal:*\n";f.forEach(i=>{m+=`${i.emoji} ${i.name.split("/")[0].trim()} — ${inr(rates[i.id])}/${i.unit}\n`;});m+="\n";}
                  if(v.length){m+="*Sabzi:*\n";v.forEach(i=>{m+=`${i.emoji} ${i.name.split("/")[0].trim()} — ${inr(rates[i.id])}/${i.unit}\n`;});m+="\n";}
                  if(g.length){m+="*Groceries:*\n";g.forEach(i=>{m+=`${i.emoji} ${i.name.split("/")[0].trim()} — ${inr(rates[i.id])}/${i.unit}\n`;});m+="\n";}
                  m+="Order ke liye reply karein!";
                  return m;
                };

                return (<>
                  {/* Row 1: Quick single send + Copy */}
                  <div style={{display:"flex",gap:8,marginBottom:8}}>
                    <button onClick={()=>{ window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(buildMsg())}`,"_blank"); }}
                      style={{flex:2,padding:"12px 0",borderRadius:12,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:14,cursor:"pointer"}}>
                      📲 WhatsApp par Bhejo
                    </button>
                    <button onClick={async()=>{
                      try{ await navigator.clipboard.writeText(buildMsg()); notify("✅ Message copy ho gaya — WhatsApp Broadcast mein paste karo!"); }
                      catch{ notify("Copy nahi hua — manually select karo","error"); }
                    }} style={{flex:1,padding:"12px 0",borderRadius:12,border:`1.5px solid ${C.lgray}`,background:"white",color:C.navy,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                      📋 Copy
                    </button>
                  </div>

                  {/* Row 2: Native Share (works on phone) */}
                  <button onClick={async()=>{
                    const msg = buildMsg();
                    if(navigator.share){ try{ await navigator.share({ title:`${shopName} — Aaj ke Rates`, text:msg }); } catch{} }
                    else{ try{ await navigator.clipboard.writeText(msg); notify("✅ Message copy ho gaya!"); } catch{ notify("Share nahi hua","error"); } }
                  }} style={{width:"100%",padding:"11px 0",borderRadius:12,border:`1.5px solid ${C.lgreen}`,background:"#F0FFF4",color:C.green,fontWeight:700,fontSize:14,cursor:"pointer",marginBottom:8}}>
                    🔗 Share (WhatsApp, SMS, ya copy)
                  </button>

                  {/* Row 3: Broadcast to saved list */}
                  <button onClick={()=>setShowBroadcast(b=>!b)}
                    style={{width:"100%",padding:"11px 0",borderRadius:12,border:`1.5px solid ${C.navy}`,background:showBroadcast?"#EEF2FF":"white",color:C.navy,fontWeight:700,fontSize:14,cursor:"pointer"}}>
                    📋 Broadcast List ({broadcastList.length} contacts) {showBroadcast?"▲":"▼"}
                  </button>

                  {/* Broadcast panel */}
                  {showBroadcast && (
                    <div style={{marginTop:10,background:"#F8FAFC",borderRadius:12,padding:"12px"}}>
                      <div style={{fontSize:12,color:C.gray,marginBottom:10}}>
                        Contacts save karo — phir ek click mein sab ko rates bhejo
                      </div>

                      {/* Existing contacts */}
                      {broadcastList.map((c,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,background:"white",borderRadius:10,padding:"8px 12px"}}>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:600,fontSize:13,color:C.navy}}>{c.name}</div>
                            <div style={{fontSize:11,color:C.gray}}>{c.number}</div>
                          </div>
                          <button onClick={()=>{
                            const num=c.number.replace(/[^0-9]/g,"");
                            const n=num.length===10?"91"+num:num;
                            window.open(`https://wa.me/${n}?text=${encodeURIComponent(buildMsg())}`,"_blank");
                          }} style={{background:"#25D366",border:"none",color:"white",borderRadius:8,padding:"5px 10px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                            Send
                          </button>
                          <button onClick={()=>setBroadcastList(p=>p.filter((_,j)=>j!==i))}
                            style={{background:"#FEE2E2",border:"none",color:"#DC2626",borderRadius:8,padding:"5px 8px",fontSize:12,cursor:"pointer"}}>✕</button>
                        </div>
                      ))}

                      {/* Send to all */}
                      {broadcastList.length>1 && (
                        <button onClick={async()=>{
                          const msg=buildMsg();
                          for(const c of broadcastList){
                            const num=c.number.replace(/[^0-9]/g,"");
                            const n=num.length===10?"91"+num:num;
                            window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`,"_blank");
                            await new Promise(r=>setTimeout(r,800));
                          }
                          notify(`📢 ${broadcastList.length} logo ko rates bheje gaye`);
                        }} style={{width:"100%",padding:"11px 0",borderRadius:10,border:"none",background:"linear-gradient(135deg,#128C7E,#25D366)",color:"white",fontWeight:800,fontSize:14,cursor:"pointer",marginBottom:10}}>
                          📢 Sab ko Bhejo ({broadcastList.length} contacts)
                        </button>
                      )}

                      {/* Copy all message for WhatsApp Broadcast */}
                      <button onClick={async()=>{
                        try{ await navigator.clipboard.writeText(buildMsg()); notify("✅ Message copy hua! WhatsApp → Broadcast Lists → message paste karo"); }
                        catch{ notify("Copy failed","error"); }
                      }} style={{width:"100%",padding:"10px 0",borderRadius:10,border:`1.5px dashed ${C.gray}`,background:"white",color:C.gray,fontWeight:600,fontSize:12,cursor:"pointer",marginBottom:10}}>
                        📋 WhatsApp Broadcast ke liye Copy Karo
                      </button>

                      {/* Add new contact */}
                      <div style={{borderTop:`1px solid ${C.lgray}`,paddingTop:10,marginTop:4}}>
                        <div style={{fontSize:12,fontWeight:700,color:C.navy,marginBottom:6}}>Naya Contact Add Karo</div>
                        <input value={broadcastInput.name} onChange={e=>setBroadcastInput(p=>({...p,name:e.target.value}))}
                          placeholder="Naam (jaise: Priya, Colony B)" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1.5px solid ${C.lgray}`,fontSize:13,boxSizing:"border-box",outline:"none",marginBottom:6}}/>
                        <input value={broadcastInput.number} onChange={e=>setBroadcastInput(p=>({...p,number:e.target.value.replace(/[^0-9]/g,"")}))}
                          placeholder="WhatsApp number (10 digit)" type="tel"
                          style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1.5px solid ${C.lgray}`,fontSize:13,boxSizing:"border-box",outline:"none",marginBottom:8}}/>
                        <button onClick={()=>{
                          if(!broadcastInput.number||broadcastInput.number.length<10){ notify("Sahi number daalo","error"); return; }
                          setBroadcastList(p=>[...p,{name:broadcastInput.name||broadcastInput.number,number:broadcastInput.number}]);
                          setBroadcastInput({name:"",number:""});
                          notify("✅ Contact add ho gaya!");
                        }} style={{width:"100%",padding:"10px 0",borderRadius:8,border:"none",background:C.navy,color:"white",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                          + Add Contact
                        </button>
                      </div>
                    </div>
                  )}
                </>);
              })()}
            </Card>
          )}
          <div style={{textAlign:"center",padding:"18px 0 8px",color:C.gray,fontSize:12}}>
            <div>👥 Total Visitors: <b style={{color:C.green}}>{visitorCount!==null?visitorCount.toLocaleString("en-IN"):"…"}</b></div>
            <div style={{marginTop:6}}>Designed by <b style={{color:C.green}}>JK Technologies</b> ™</div>
            <button onClick={async()=>{
              const shareData={ title:"FreshBill — Sabzi App", text:"FreshBill: Fruit, Sabzi aur Grocery ka smart app! Vendors ke rates dekho, compare karo, WhatsApp par order karo.", url:"https://freshbill-delta.vercel.app" };
              if(navigator.share){ try{ await navigator.share(shareData); } catch{} }
              else{ try{ await navigator.clipboard.writeText("FreshBill app: https://freshbill-delta.vercel.app"); notify("Link copy ho gaya!"); } catch{} }
            }} style={{marginTop:10,padding:"9px 22px",borderRadius:12,border:`1.5px solid ${C.green}`,background:"#F0FFF4",color:C.green,fontWeight:700,fontSize:12,cursor:"pointer"}}>
              🔗 App Share Karo
            </button>
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

          {(()=>{ try {
            const q = billSearch.trim().toLowerCase();
            const billMatches = q ? ratedItems.filter(i=>i.name.toLowerCase().includes(q) || (i.hi||"").includes(billSearch.trim()) || (i.pa||"").includes(billSearch.trim())) : ratedItems;
            // An item that already exists in the catalog (any category, rated or not) matching the search — but has no rate yet
            const unratedMatch = q ? items.find(i=>!rates[i.id] && (i.name.toLowerCase().includes(q) || (i.hi||"").includes(billSearch.trim()) || (i.pa||"").includes(billSearch.trim()))) : null;
            // Totally unknown item — nothing in the whole catalog matches at all
            const noMatchAtAll = q && billMatches.length===0 && !unratedMatch;
            const guess = q ? guessItemEmoji(billSearch) : null;
            const previewEmoji = quickEmoji || (guess ? guess.emoji : "🧺");
            return (<>
              <Card style={{marginBottom:14}}>
                <input value={billSearch}
                  onChange={e=>{ setBillSearch(e.target.value); setQuickEmoji(null); setQuickEmojiPick(false); }}
                  placeholder="🔍 Item dhoondo... nahi mila to turant add karo"
                  style={{width:"100%",padding:"11px 13px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,boxSizing:"border-box",outline:"none"}}/>
              </Card>

              {ratedItems.length===0 && !q && (
                <Card><div style={{textAlign:"center",padding:"20px 0",color:C.gray}}>
                  <div style={{fontSize:36}}>📋</div>
                  <div style={{fontWeight:600,marginTop:8}}>Koi item ready nahi hai</div>
                  <div style={{fontSize:12,marginTop:4}}>Upar search karke naya item turant add karo, ya</div>
                  <button onClick={()=>setTab("rates")} style={{marginTop:12,padding:"10px 20px",borderRadius:12,border:"none",background:C.green,color:"white",fontWeight:700,cursor:"pointer"}}>Rates Tab →</button>
                </div></Card>
              )}

              {billMatches.length>0 && (
                <>
                  <div style={{fontWeight:700,color:C.navy,marginBottom:8}}>Items chunno:</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                    {billMatches.map(item=>{
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

              {/* Item exists in catalog but has no rate set — set it right here and drop into bill */}
              {unratedMatch && (
                <Card style={{marginBottom:14,border:`2px dashed ${C.gold}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <span style={{fontSize:28}}>{unratedMatch.emoji}</span>
                    <div>
                      <div style={{fontWeight:800,color:C.navy,fontSize:14}}>{itemName(unratedMatch, appLang)}</div>
                      <div style={{fontSize:11,color:C.gray}}>Rate abhi set nahi hai — daal ke seedha bill mein add karo</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <input type="number" placeholder={`Rate ₹/${unratedMatch.unit}`} value={quickRate} onChange={e=>setQuickRate(e.target.value)}
                      style={{flex:1,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,outline:"none"}}/>
                    <button onClick={()=>quickSetRateAndBill(unratedMatch)}
                      style={{padding:"10px 16px",borderRadius:10,border:"none",background:C.green,color:"white",fontWeight:800,cursor:"pointer",whiteSpace:"nowrap"}}>
                      🛒 Add
                    </button>
                  </div>
                </Card>
              )}

              {/* Nothing in the catalog matches at all — create a brand-new item on the fly */}
              {noMatchAtAll && (
                <Card style={{marginBottom:14,border:`2px dashed ${C.lgreen}`}}>
                  <div style={{fontWeight:800,color:C.navy,fontSize:14,marginBottom:2}}>➕ Naya Item: "{billSearch.trim()}"</div>
                  <div style={{fontSize:11,color:C.gray,marginBottom:10}}>List mein nahi mila — emoji khud-ba-khud chun liya gaya hai, chaho to badal do</div>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <button onClick={()=>setQuickEmojiPick(!quickEmojiPick)}
                      style={{fontSize:28,background:C.lgray,border:"none",borderRadius:10,padding:"6px 12px",cursor:"pointer"}}>{previewEmoji}</button>
                    <div style={{fontSize:12,color:C.gray}}>Emoji badalne ke liye tap karo</div>
                  </div>
                  {quickEmojiPick && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10,background:C.lgray,borderRadius:10,padding:10}}>
                      {EMOJIS.map(e=><button key={e} onClick={()=>{setQuickEmoji(e);setQuickEmojiPick(false);}} style={{fontSize:22,background:previewEmoji===e?"#C8E6C9":"transparent",border:"none",borderRadius:8,padding:4,cursor:"pointer"}}>{e}</button>)}
                    </div>
                  )}
                  <div style={{display:"flex",gap:8}}>
                    <input type="number" placeholder={`Rate ₹/${guess.unit}`} value={quickRate} onChange={e=>setQuickRate(e.target.value)}
                      style={{flex:1,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${C.lgray}`,fontSize:14,outline:"none"}}/>
                    <button onClick={quickAddAndBill}
                      style={{padding:"10px 16px",borderRadius:10,border:"none",background:C.green,color:"white",fontWeight:800,cursor:"pointer",whiteSpace:"nowrap"}}>
                      🛒 Add
                    </button>
                  </div>
                </Card>
              )}
            </>);
          } catch(err) {
            console.error("Bill tab error:", err);
            return <div style={{textAlign:"center",padding:"40px 0",color:C.red}}>
              <div style={{fontSize:36}}>⚠️</div>
              <div style={{fontWeight:700,marginTop:8}}>Bill tab mein error aa gaya</div>
              <div style={{fontSize:12,color:C.gray,marginTop:4}}>{String(err.message||err).slice(0,100)}</div>
              <button onClick={()=>{ setBillSearch(""); setQuickRate(""); setQuickEmoji(null); }}
                style={{marginTop:12,padding:"10px 20px",borderRadius:12,border:"none",background:C.green,color:"white",fontWeight:700,cursor:"pointer"}}>
                Reset Karo
              </button>
            </div>;
          }
          })()}

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
