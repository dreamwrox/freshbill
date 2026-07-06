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
  { id:"potato",       name:"Potato / Aalu",            emoji:"🥔", hi:"आलू", pa