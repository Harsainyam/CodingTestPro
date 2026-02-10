# 🚀 CodeTest Pro - AI-Powered Coding Test Platform

A comprehensive coding test platform with real-time AI-powered proctoring, live monitoring, and automated evaluation.

## ✨ Features

### For Admins
- 📝 Create custom coding tests with multiple questions
- ⏱️ Set test duration and time limits
- 🧪 Add visible and hidden test cases
- 📊 Live monitoring dashboard with real-time video feeds
- 🔍 AI-powered proctoring alerts
- 📈 View detailed submission reports
- 🔗 Generate shareable test links

### For Students
- 💻 Clean, distraction-free code editor
- ▶️ Run test cases before submission
- 🧪 Test with custom inputs
- ⏰ Live timer display
- 📹 Camera & microphone monitoring
- 🎯 Question navigation sidebar

### AI Proctoring Features
- 📷 Continuous video monitoring
- 🤖 AI detection for suspicious activities:
  - Looking away from screen
  - Phone usage detection
  - Multiple people detection
- 🚨 Real-time violation alerts
- 📊 Tab switch detection
- 🔴 Live video streaming to admin
- 📝 Code monitoring (live updates)

## 🛠️ Tech Stack

- **Backend**: Node.js, Express
- **Real-time**: Socket.IO
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **AI**: Client-side detection (expandable with TensorFlow.js)

## 📦 Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Local Setup

1. **Clone or download this project**

2. **Install dependencies**
```bash
npm install
```

3. **Start the server**
```bash
npm start
```

4. **Access the platform**
- Main page: http://localhost:3000
- Admin dashboard: http://localhost:3000/admin.html
- Default credentials: `username: admin`, `password: admin123`

## 🌐 Deploy to Render

### Step 1: Prepare Your Files
Make sure all files are in a Git repository.

### Step 2: Create Render Account
1. Go to https://render.com
2. Sign up for a free account

### Step 3: Deploy

1. **Click "New +"** → **"Web Service"**

2. **Connect your Git repository** or upload files

3. **Configure the service**:
   - Name: `codetest-pro` (or any name)
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: `Free`

4. **Add Environment Variables** (Optional):
   - `PORT`: 3000 (Render sets this automatically)
   - `NODE_ENV`: production

5. **Click "Create Web Service"**

6. **Wait for deployment** (usually 2-5 minutes)

7. **Access your app** at the provided Render URL (e.g., `https://your-app.onrender.com`)

### Important Notes for Render:
- The free tier may spin down after inactivity
- First request after inactivity may take 30-60 seconds
- For production use, consider paid plans for always-on service

## 📖 How to Use

### For Admins

1. **Login**
   - Navigate to `/admin.html`
   - Use credentials: `admin` / `admin123`

2. **Create a Test**
   - Go to "Create Test" tab
   - Enter test title and duration
   - Add questions with:
     - Title and description
     - Code template
     - Visible test cases (shown to students)
     - Hidden test cases (for evaluation)
   - Click "Create Test"

3. **Share Test Link**
   - Copy the generated link
   - Send to students via email/chat

4. **Monitor Live**
   - Open "Live Monitor" tab
   - View real-time video feeds
   - See code being written
   - Receive AI proctoring alerts

5. **Review Submissions**
   - Check "Submissions" tab
   - View answers and proctoring data
   - Check violation counts

### For Students

1. **Join Test**
   - Open the test link provided by admin
   - Enter name and email
   - Click "Start Test"

2. **Grant Permissions**
   - Allow camera and microphone access
   - These are required for proctoring

3. **Take Test**
   - Select questions from sidebar
   - Write code in the editor
   - Run test cases to verify
   - Submit each question
   - Submit entire test when done

## ⚙️ Configuration

### Change Admin Password
Edit `server.js` and modify the users object:
```javascript
const users = {
  admin: {
    username: 'admin',
    password: 'your-new-password-here',
    role: 'admin'
  }
};
```

For production, use bcrypt to hash passwords.

### Code Execution
Currently uses **mock execution**. For real code execution, integrate:

1. **Judge0 API** (Recommended)
   - Sign up at https://judge0.com
   - Get API key
   - Update `/api/execute` endpoint

2. **Piston API**
   - Free API: https://emkc.org/api/v2/piston
   - Update execution logic

3. **Self-hosted sandbox**
   - Use Docker containers
   - Run code in isolated environments

### AI Proctoring Enhancement
For advanced AI detection:

1. **TensorFlow.js**
```javascript
// Add to test.html
<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface"></script>
```

2. **Backend AI Service**
   - Integrate with Google Vision API
   - Use Amazon Rekognition
   - Custom ML models

## 🔒 Security Considerations

### Before Production:
1. ✅ Change default admin password
2. ✅ Use HTTPS (Render provides this automatically)
3. ✅ Implement proper authentication (JWT tokens)
4. ✅ Use database instead of in-memory storage
5. ✅ Add rate limiting
6. ✅ Sanitize user inputs
7. ✅ Implement CORS properly
8. ✅ Hash passwords with bcrypt
9. ✅ Add session management
10. ✅ Implement file upload limits

## 🗄️ Database Integration

Replace in-memory storage with a real database:

**MongoDB Example**:
```javascript
npm install mongodb mongoose

// In server.js
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);
```

**PostgreSQL Example**:
```javascript
npm install pg

// Use with Sequelize or Knex.js
```

## 📧 Email Notifications

Add email notifications for test invites:

```javascript
npm install nodemailer

const nodemailer = require('nodemailer');
// Configure email sending
```

## 🎨 Customization

### Styling
- Edit CSS in HTML files
- Customize colors in `:root` variables
- Modify layouts as needed

### Features
- Add more programming languages
- Implement code plagiarism detection
- Add video recording download
- Integrate with LMS systems

## 🐛 Troubleshooting

### Camera not working
- Ensure HTTPS is enabled (required for camera access)
- Check browser permissions
- Works best on Chrome/Firefox

### Socket.IO connection issues
- Check firewall settings
- Ensure WebSocket support
- Verify Render configuration

### Test execution not working
- This is mock execution by default
- Integrate real code execution service
- Check API keys and endpoints

## 📝 License

MIT License - feel free to modify and use for your projects!

## 🤝 Contributing

Contributions welcome! Please feel free to submit issues and pull requests.

## ⚠️ Disclaimer

This platform includes monitoring features. Ensure you:
- Have explicit consent from test takers
- Comply with local privacy laws
- Use responsibly and ethically
- Inform users about data collection

## 📞 Support

For issues or questions:
1. Check this README
2. Review code comments
3. Open an issue on GitHub
4. Contact the developer

---

**Made with ❤️ for better coding assessments**
