# FreshBill — Setup before going live

Your app already does everything: item rates, billing, WhatsApp bill, 14-day
trial, ₹100/month paywall, and a hidden admin panel that generates a unique
unlock code per device per month.

## 3 things you MUST change in `src/App.jsx` before deploying

1. **Admin secret** (line ~21)
   `const ADMIN_SECRET = "HARJIT2024";`
   Change this to your own private word. It is both your admin-panel password
   AND the secret used to generate codes. Keep it private — anyone who knows it
   can generate codes.

2. **Your UPI ID** (line ~79)
   `const GPAY_UPI  = "harjeet.pahwa-1@oksbi";`
   `const GPAY_NAME = "Harjit Singh Pahwa";`
   Set these to the account where you want the ₹100 to arrive.

3. **Your WhatsApp number** (line ~81)
   `const ADMIN_WA = "91XXXXXXXXXX";`
   Put your number with country code, no +, no spaces. e.g. `919812345678`

## How the code system works
- Each phone shows a unique **Device ID** (8 chars).
- Customer pays ₹100, sends you their Device ID on WhatsApp.
- You open the **Admin panel** (see below), type their Device ID, get a code.
- The code only works on THAT device and ONLY for the current month.
- Next month they need a new code → recurring ₹100/month.

## How to open the Admin panel
Tap the **⚙️ gear icon** in the top-right of the home screen, then enter your
ADMIN_SECRET password. Customers can see the gear but can't get past the
password, so your code-generator stays protected.

## Deploy to Vercel
1. Push this `freshbill-deploy` folder to a GitHub repo.
2. On vercel.com → New Project → import the repo.
3. Vercel auto-detects Vite. Click Deploy. Done.
