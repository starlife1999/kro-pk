# Resend Email Setup Guide

## Overview
Your KRO PK store has been migrated from Gmail SMTP (nodemailer) to **Resend**, a modern email API service. This provides better reliability, delivery rates, and easier setup.

## Step 1: Create a Free Resend Account

1. Go to [resend.com](https://resend.com)
2. Click **Sign Up** and create your free account
3. Verify your email address
4. Log in to the dashboard

## Step 2: Get Your API Key

1. In the Resend dashboard, navigate to **API Keys** (in the left sidebar)
2. Click **Create API Key**
3. Give it a name (e.g., "KRO-PK-Store")
4. Copy the API key (it will look like: `re_...`)
5. **Save this key securely** - you'll need it next

## Step 3: Update Your Environment Variables

### For Local Development:
1. Create a `.env` file in your project root (copy from `.env.example`):
   ```bash
   PORT=3000
   JWT_SECRET=your-jwt-secret-here
   ADMIN_EMAIL=admin@kropk.com
   ADMIN_PASSWORD=your-admin-password
   OWNER_EMAIL=orders@kropk.com
   MONGODB_URI=mongodb://localhost:27017/kro_pk_store
   RESEND_API_KEY=re_your_api_key_here
   EMAIL_FROM=onboarding@resend.dev
   ```

2. Replace `re_your_api_key_here` with your actual API key from Step 2

### For Production (Railway):
1. Go to your Railway project dashboard
2. Select your service and go to **Variables**
3. Add these environment variables:
   - `RESEND_API_KEY`: Paste your API key
   - `EMAIL_FROM`: Your verified sender email (see Step 4)

## Step 4: Verify Sender Email (for production)

**For Testing:** You can use `onboarding@resend.dev` (default) to send test emails immediately.

**For Production:** To send from your own email address:

1. In the Resend dashboard, go to **Domains**
2. Click **Add Domain**
3. Enter your domain (e.g., `mail.kropk.com` or use `resend.dev` subdomain)
4. Follow the DNS verification steps
5. Once verified, update `EMAIL_FROM` in your environment variables

**Simple Alternative:** Use Resend's sandbox mode or keep using `onboarding@resend.dev` while testing.

## Step 5: Test Email Sending

1. Start your server:
   ```bash
   npm run dev
   ```

2. Place a test order through the store
3. Check the server logs - you should see:
   ```
   Email config: { from: 'onboarding@resend.dev', owner: 'orders@kropk.com', resendKeySet: true }
   Email sent successfully: <email-id>
   ```

4. The order notification email will be sent to the address in `OWNER_EMAIL`

## Code Changes Made

### Updated Files:
- **src/server.js**:
  - Removed nodemailer imports
  - Changed `createOrderEmail()` to return HTML-formatted emails
  - Replaced `transporter.sendMail()` with `resend.emails.send()`
  - Updated email config logging

- **.env.example**:
  - Removed `EMAIL_USER` and `EMAIL_PASS` (Gmail SMTP credentials)
  - Added `RESEND_API_KEY`
  - Added `EMAIL_FROM`

### Package Info:
- `resend` package (^6.12.3) is already installed in `package.json`

## Resend API Pricing

**Free Tier:**
- 100 emails/day
- Perfect for development and testing

**Paid Plans:**
- Scale up to send more emails
- Detailed analytics and tracking
- Advanced features (templates, webhooks, etc.)

See [resend.com/pricing](https://resend.com/pricing) for details.

## Troubleshooting

### Email not sending?

1. **Check API Key**: Ensure `RESEND_API_KEY` is set correctly
2. **Check Sender Email**: Verify `EMAIL_FROM` is valid/verified in Resend
3. **Check Logs**: Look at server console for error messages
4. **Test with cURL**:
   ```bash
   curl -X POST https://api.resend.com/emails \
     -H 'Authorization: Bearer YOUR_API_KEY' \
     -H 'Content-Type: application/json' \
     -d '{
       "from": "onboarding@resend.dev",
       "to": "delivered@resend.dev",
       "subject": "Test",
       "html": "<p>Test email</p>"
     }'
   ```

### Sandbox vs Production?

By default, Resend operates in **sandbox mode** with the free tier:
- You can send to verified test emails
- `delivered@resend.dev` always works
- Use this for development

To go to production, you'll need to:
1. Verify your domain
2. Upgrade your plan (if needed)
3. Update `EMAIL_FROM` to your verified domain

## Next Steps

1. ✅ Create Resend account
2. ✅ Get API key
3. ✅ Set environment variables
4. ✅ Test email sending
5. ✅ Deploy to production with verified domain (optional)

## Support

- [Resend Docs](https://resend.com/docs)
- [Resend API Reference](https://resend.com/docs/api-reference)
- [GitHub Issues](https://github.com/resendlabs/resend-node)
