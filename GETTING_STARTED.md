# 🎯 Getting Started with CodeTest Pro

Welcome to CodeTest Pro! This guide will help you get your coding test platform up and running in minutes.

## 📁 What You Have

Your package includes:
- ✅ Complete Node.js application
- ✅ Admin dashboard
- ✅ Student test interface
- ✅ Live monitoring system
- ✅ AI-powered proctoring
- ✅ Deployment configurations
- ✅ Comprehensive documentation

## 🚀 Quick Start (3 Steps)

### Step 1: Test Locally

**On macOS/Linux:**
```bash
cd coding-test-platform
chmod +x setup.sh
./setup.sh
npm start
```

**On Windows:**
```bash
cd coding-test-platform
setup.bat
npm start
```

**Or manually:**
```bash
cd coding-test-platform
npm install
npm start
```

### Step 2: Access the Application
Open your browser to:
- **Main Page**: http://localhost:3000
- **Admin Dashboard**: http://localhost:3000/admin.html
  - Username: `admin`
  - Password: `admin123`

### Step 3: Create Your First Test
1. Login to admin dashboard
2. Click "Create Test"
3. Fill in test details
4. Add questions with test cases
5. Click "Create Test"
6. Share the generated link!

## 🌐 Deploy to Production (Render)

### Prerequisites
- GitHub account (free)
- Render account (free)

### Deployment Steps

1. **Create GitHub Repository**
   ```bash
   cd coding-test-platform
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Push to GitHub**
   - Create a new repository on GitHub
   - Follow GitHub's instructions to push your code

3. **Deploy on Render**
   - Go to https://render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Configure:
     - Build Command: `npm install`
     - Start Command: `npm start`
   - Click "Create Web Service"
   - Wait 2-5 minutes

4. **Done!** Access at: `https://your-app.onrender.com`

## 📚 Documentation Guide

- **README.md** - Complete documentation
- **DEPLOYMENT.md** - Detailed deployment instructions
- **FEATURES.md** - Full feature list
- **This file** - Quick start guide

## 🎓 Usage Examples

### Creating a Test

```
Test Title: "Java Fundamentals Quiz"
Duration: 60 minutes
Instructions: "Complete all questions..."

Question 1:
  Title: "Sum of Two Numbers"
  Description: "Create a method that adds two integers"
  Template: "public class Solution { ... }"
  Visible Test Cases:
    - Input: "2, 3" | Output: "5"
    - Input: "10, 20" | Output: "30"
  Hidden Test Cases:
    - Input: "-5, 5" | Output: "0"
    - Input: "100, 200" | Output: "300"
```

### Sharing with Students

1. Copy the test link from admin dashboard
2. Send via email/chat: `https://your-app.com/test.html?id=abc123`
3. Student opens link, enters details, takes test
4. You monitor live from the monitoring dashboard

### Monitoring Tests

1. Open "Live Monitor" tab in admin
2. Or navigate to `/monitor.html`
3. See all active test sessions
4. View real-time video feeds
5. Monitor code being written
6. Receive AI proctoring alerts

## ⚙️ Configuration

### Change Admin Password
Edit `server.js` around line 25:
```javascript
const users = {
  admin: {
    username: 'admin',
    password: 'your-new-password',  // Change this
    role: 'admin'
  }
};
```

### Add More Languages
Currently supports Java. To add more:
1. Update language dropdown in `test.html`
2. Integrate code execution API (Judge0/Piston)
3. Add language-specific templates

### Enable Real Code Execution
The platform uses mock execution. For real execution:

**Option 1: Judge0 API** (Recommended)
```javascript
// Get free API key from https://judge0.com
// Update /api/execute endpoint in server.js
```

**Option 2: Piston API** (Free)
```javascript
// Use https://emkc.org/api/v2/piston
// No API key needed
```

## 🔧 Advanced Features

### Add Database
```bash
npm install mongodb mongoose
# Configure in server.js
```

### Add Email Notifications
```bash
npm install nodemailer
# Configure SMTP settings
```

### Enhanced AI Proctoring
```javascript
// Add to test.html
<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface"></script>
```

## 🐛 Common Issues

### Camera Not Working
- ✅ Use HTTPS (Render provides this automatically)
- ✅ Grant browser permissions
- ✅ Use Chrome or Firefox

### Port Already in Use
```bash
# Change port in server.js
const PORT = process.env.PORT || 3001;
```

### Socket.IO Connection Failed
- ✅ Check firewall settings
- ✅ Ensure WebSocket support
- ✅ Try different browser

## 📞 Need Help?

1. **Check Documentation**
   - README.md for detailed info
   - FEATURES.md for feature list
   - DEPLOYMENT.md for deployment help

2. **Review Code Comments**
   - All files are well-commented
   - Follow the code flow

3. **Test Locally First**
   - Ensure it works locally
   - Then deploy to Render

## ✅ Checklist Before Going Live

- [ ] Changed default admin password
- [ ] Tested test creation
- [ ] Tested student flow (camera, code editor)
- [ ] Verified monitoring dashboard works
- [ ] Integrated real code execution (optional)
- [ ] Set up database (for production)
- [ ] Configured email notifications (optional)
- [ ] Reviewed privacy/consent requirements
- [ ] Tested on target browsers
- [ ] Deployed to Render
- [ ] Created test user account

## 🎉 You're Ready!

Your CodeTest Pro platform is ready to use. Start creating tests and monitoring students with confidence!

### Quick Links
- 🏠 Home: http://localhost:3000
- 👤 Admin: http://localhost:3000/admin.html
- 📺 Monitor: http://localhost:3000/monitor.html

---

**Happy Testing!** 🚀

For more detailed information, see README.md
