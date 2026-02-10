# 🚀 Quick Deployment Guide to Render

## Option 1: Deploy from GitHub (Recommended)

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### Step 2: Deploy on Render
1. Go to https://render.com and sign up
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account
4. Select your repository
5. Configure:
   - **Name**: codetest-pro
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
6. Click **"Create Web Service"**
7. Wait 2-5 minutes for deployment
8. Access your app at the provided URL!

## Option 2: Deploy from Local Files

### Step 1: Create a Git Repository
```bash
cd coding-test-platform
git init
git add .
git commit -m "Initial commit"
```

### Step 2: Push to GitHub/GitLab
- Create a new repository on GitHub
- Follow the push instructions

### Step 3: Follow Option 1 steps 2-8

## Option 3: Manual Upload (if no Git)

1. Compress the `coding-test-platform` folder as ZIP
2. On Render, select **"Deploy from ZIP"** option
3. Upload your ZIP file
4. Follow same configuration steps

## ⚙️ Post-Deployment

### Access Your Application
- **Main Page**: `https://your-app.onrender.com`
- **Admin Dashboard**: `https://your-app.onrender.com/admin.html`
- **Login**: `admin` / `admin123`

### Important: Change Default Password!
Edit `server.js` line 25 to change the admin password.

### Test the Platform
1. Login to admin dashboard
2. Create a test
3. Copy the test link
4. Open in incognito/private window
5. Take the test
6. Monitor live from admin dashboard

## 🔧 Troubleshooting

### App is slow to start
- Render free tier spins down after inactivity
- First request may take 30-60 seconds
- Consider upgrading to paid plan for production

### Camera not working
- Ensure you're accessing via HTTPS (Render provides this)
- Browser must support WebRTC
- Grant camera/microphone permissions

### Socket.IO not connecting
- Check browser console for errors
- Ensure WebSocket support is enabled
- May need to configure CORS for production

## 📧 Need Help?
- Check README.md for detailed documentation
- Review code comments
- Contact support

---
**Your coding test platform is ready! 🎉**
