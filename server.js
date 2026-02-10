const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use(session({
  secret: 'coding-test-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true with HTTPS in production
}));

// In-memory storage (replace with database in production)
const users = {
  admin: {
    username: 'admin',
    password: '$2a$10$X7ZYvVqH8yOaKKmYC.xYRO7GvQqKqH0GxQxQxQxQxQxQxQxQxQx', // 'admin123'
    role: 'admin'
  }
};

const tests = {}; // testId -> test object
const submissions = {}; // submissionId -> submission object
const activeTests = {}; // sessionId -> active test session
const proctoringData = {}; // sessionId -> proctoring logs

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden' });
  }
};

// Helper function to get language config for Piston API
function getPistonLanguageConfig(language) {
  const configs = {
    'javascript': { language: 'javascript', version: '18.15.0', file: 'script.js' },
    'python': { language: 'python', version: '3.10.0', file: 'script.py' },
    'java': { language: 'java', version: '15.0.2', file: 'Main.java' },
    'cpp': { language: 'c++', version: '10.2.0', file: 'main.cpp' },
    'c': { language: 'c', version: '10.2.0', file: 'main.c' },
    'csharp': { language: 'csharp', version: '6.12.0', file: 'Main.cs' }
  };
  return configs[language] || configs['javascript'];
}

// Routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === 'admin' && password === 'admin123') {
    req.session.user = { username: 'admin', role: 'admin' };
    res.json({ success: true, role: 'admin' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/check-auth', (req, res) => {
  if (req.session.user) {
    res.json({ authenticated: true, role: req.session.user.role });
  } else {
    res.json({ authenticated: false });
  }
});

// Test Management APIs
app.post('/api/tests', requireAdmin, (req, res) => {
  const testId = uuidv4();
  const test = {
    id: testId,
    ...req.body,
    createdAt: new Date().toISOString(),
    link: `${req.protocol}://${req.get('host')}/test.html?id=${testId}`
  };
  tests[testId] = test;
  res.json({ success: true, test });
});

app.get('/api/tests', requireAdmin, (req, res) => {
  res.json(Object.values(tests));
});

app.get('/api/tests/:id', (req, res) => {
  const test = tests[req.params.id];
  if (test) {
    // Return test data without hidden test cases for security
    const sanitizedTest = {
      ...test,
      questions: test.questions ? test.questions.map(q => ({
        ...q,
        hiddenTestCases: undefined // Remove hidden test cases from client response
      })) : []
    };
    res.json(sanitizedTest);
  } else {
    res.status(404).json({ error: 'Test not found' });
  }
});

app.put('/api/tests/:id', requireAdmin, (req, res) => {
  const testId = req.params.id;
  if (tests[testId]) {
    tests[testId] = {
      ...tests[testId],
      ...req.body,
      updatedAt: new Date().toISOString()
    };
    res.json({ success: true, test: tests[testId] });
  } else {
    res.status(404).json({ error: 'Test not found' });
  }
});

app.delete('/api/tests/:id', requireAdmin, (req, res) => {
  if (tests[req.params.id]) {
    delete tests[req.params.id];
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Test not found' });
  }
});

// Test Session APIs
app.post('/api/test-session/start', (req, res) => {
  const { testId, candidateName, candidateEmail } = req.body;
  const test = tests[testId];
  
  if (!test) {
    return res.status(404).json({ error: 'Test not found' });
  }
  
  // Validate input
  if (!candidateName || !candidateEmail) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  
  const sessionId = uuidv4();
  activeTests[sessionId] = {
    sessionId,
    testId,
    candidateName,
    candidateEmail,
    startTime: new Date().toISOString(),
    answers: {},
    proctoringLogs: [],
    tabSwitches: 0,
    violations: [],
    status: 'in_progress'
  };
  
  proctoringData[sessionId] = {
    frames: [],
    alerts: [],
    codeSnapshots: []
  };
  
  req.session.testSession = sessionId;
  res.json({ success: true, sessionId, startTime: activeTests[sessionId].startTime });
});

app.post('/api/test-session/submit', (req, res) => {
  const sessionId = req.session.testSession || req.body.sessionId;
  const session = activeTests[sessionId];
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  if (session.status === 'submitted') {
    return res.status(400).json({ error: 'Test already submitted' });
  }
  
  session.endTime = new Date().toISOString();
  session.answers = req.body.answers || {};
  session.status = 'submitted';
  
  // Calculate test duration
  const startTime = new Date(session.startTime);
  const endTime = new Date(session.endTime);
  session.duration = Math.floor((endTime - startTime) / 1000); // in seconds
  
  const submissionId = uuidv4();
  submissions[submissionId] = {
    id: submissionId,
    ...session,
    proctoringData: proctoringData[sessionId],
    submittedAt: session.endTime
  };
  
  // Notify admin about submission
  io.to('admin-room').emit('test-submitted', {
    submissionId,
    sessionId,
    candidateName: session.candidateName,
    candidateEmail: session.candidateEmail
  });
  
  res.json({ 
    success: true, 
    submissionId,
    message: 'Test submitted successfully' 
  });
});

app.get('/api/submissions', requireAdmin, (req, res) => {
  const submissionList = Object.values(submissions).map(sub => ({
    id: sub.id,
    sessionId: sub.sessionId,
    candidateName: sub.candidateName,
    candidateEmail: sub.candidateEmail,
    testId: sub.testId,
    startTime: sub.startTime,
    endTime: sub.endTime,
    duration: sub.duration,
    status: sub.status,
    tabSwitches: sub.tabSwitches,
    violations: sub.violations.length,
    answeredQuestions: Object.keys(sub.answers).length
  }));
  res.json(submissionList);
});

app.get('/api/submissions/:id', requireAdmin, (req, res) => {
  const submission = submissions[req.params.id];
  if (submission) {
    res.json(submission);
  } else {
    res.status(404).json({ error: 'Submission not found' });
  }
});

// Enhanced Code Execution API with multi-language support
app.post('/api/execute', async (req, res) => {
  const { code, testCases, language = 'javascript' } = req.body;
  
  if (!code || !testCases || testCases.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Code and test cases are required' 
    });
  }
  
  try {
    const results = [];
    const langConfig = getPistonLanguageConfig(language);
    
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const startTime = Date.now();
      
      try {
        // Call Piston API for code execution
        const response = await fetch('https://emkc.org/api/v2/piston/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: langConfig.language,
            version: langConfig.version,
            files: [{
              name: langConfig.file,
              content: code
            }],
            stdin: testCase.input || '',
            args: [],
            compile_timeout: 10000,
            run_timeout: 3000,
            compile_memory_limit: -1,
            run_memory_limit: -1
          })
        });
        
        if (!response.ok) {
          throw new Error(`Execution service error: ${response.statusText}`);
        }
        
        const result = await response.json();
        const executionTime = Date.now() - startTime;
        
        // Check if there were compilation errors
        if (result.compile && result.compile.stderr) {
          results.push({
            testCase: i + 1,
            input: testCase.input,
            expectedOutput: testCase.output,
            actualOutput: '',
            passed: false,
            executionTime,
            error: `Compilation Error: ${result.compile.stderr}`,
            status: 'compilation_error'
          });
          continue;
        }
        
        // Check if there were runtime errors
        if (result.run && result.run.stderr && result.run.code !== 0) {
          results.push({
            testCase: i + 1,
            input: testCase.input,
            expectedOutput: testCase.output,
            actualOutput: result.run.stdout ? result.run.stdout.trim() : '',
            passed: false,
            executionTime,
            error: `Runtime Error: ${result.run.stderr}`,
            status: 'runtime_error'
          });
          continue;
        }
        
        // Get the output
        const actualOutput = (result.run?.stdout || '').trim();
        const expectedOutput = (testCase.output || '').trim();
        
        // Compare outputs (normalize line endings and whitespace)
        const normalizedActual = actualOutput.replace(/\r\n/g, '\n').replace(/\s+$/, '');
        const normalizedExpected = expectedOutput.replace(/\r\n/g, '\n').replace(/\s+$/, '');
        const passed = normalizedActual === normalizedExpected;
        
        results.push({
          testCase: i + 1,
          input: testCase.input,
          expectedOutput: expectedOutput,
          actualOutput: actualOutput,
          passed: passed,
          executionTime,
          status: passed ? 'passed' : 'failed',
          stderr: result.run?.stderr || null
        });
        
      } catch (error) {
        console.error('Execution error for test case', i + 1, ':', error);
        results.push({
          testCase: i + 1,
          input: testCase.input,
          expectedOutput: testCase.output,
          actualOutput: '',
          passed: false,
          executionTime: Date.now() - startTime,
          error: error.message,
          status: 'execution_error'
        });
      }
    }
    
    const passedCount = results.filter(r => r.passed).length;
    const totalCount = results.length;
    
    res.json({
      success: true,
      results,
      summary: {
        total: totalCount,
        passed: passedCount,
        failed: totalCount - passedCount,
        allPassed: results.every(r => r.passed),
        percentage: totalCount > 0 ? ((passedCount / totalCount) * 100).toFixed(2) : 0
      }
    });
    
  } catch (error) {
    console.error('Code execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Code execution failed',
      message: error.message
    });
  }
});

// Custom input execution endpoint
app.post('/api/execute/custom', async (req, res) => {
  const { code, customInput, language = 'javascript' } = req.body;
  
  if (!code) {
    return res.status(400).json({ 
      success: false, 
      error: 'Code is required' 
    });
  }
  
  try {
    const langConfig = getPistonLanguageConfig(language);
    const startTime = Date.now();
    
    const response = await fetch('https://emkc.org/api/v2/piston/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: langConfig.language,
        version: langConfig.version,
        files: [{
          name: langConfig.file,
          content: code
        }],
        stdin: customInput || '',
        args: [],
        compile_timeout: 10000,
        run_timeout: 3000,
        compile_memory_limit: -1,
        run_memory_limit: -1
      })
    });
    
    if (!response.ok) {
      throw new Error(`Execution service error: ${response.statusText}`);
    }
    
    const result = await response.json();
    const executionTime = Date.now() - startTime;
    
    // Handle compilation errors
    if (result.compile && result.compile.stderr) {
      return res.json({
        success: false,
        error: 'Compilation Error',
        stderr: result.compile.stderr,
        executionTime
      });
    }
    
    // Handle runtime errors
    if (result.run && result.run.stderr && result.run.code !== 0) {
      return res.json({
        success: true,
        output: result.run.stdout || '',
        stderr: result.run.stderr,
        exitCode: result.run.code,
        executionTime,
        hasError: true
      });
    }
    
    res.json({
      success: true,
      output: result.run?.stdout || '',
      stderr: result.run?.stderr || null,
      exitCode: result.run?.code || 0,
      executionTime,
      hasError: false
    });
    
  } catch (error) {
    console.error('Custom execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Execution failed',
      message: error.message
    });
  }
});

// Proctoring APIs
app.post('/api/proctoring/log', (req, res) => {
  const sessionId = req.session.testSession || req.body.sessionId;
  
  if (!sessionId || !activeTests[sessionId]) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const log = {
    timestamp: new Date().toISOString(),
    ...req.body
  };
  
  activeTests[sessionId].proctoringLogs.push(log);
  
  if (req.body.type === 'tab-switch') {
    activeTests[sessionId].tabSwitches++;
    
    // Notify admin about tab switch
    io.to('admin-room').emit('proctoring-event', {
      sessionId,
      event: 'tab_switch',
      count: activeTests[sessionId].tabSwitches,
      candidateName: activeTests[sessionId].candidateName,
      timestamp: log.timestamp
    });
  }
  
  if (req.body.type === 'violation') {
    activeTests[sessionId].violations.push(log);
    
    // Notify admin about violation
    io.to('admin-room').emit('proctoring-event', {
      sessionId,
      event: 'violation',
      description: req.body.description,
      candidateName: activeTests[sessionId].candidateName,
      timestamp: log.timestamp
    });
  }
  
  res.json({ success: true });
});

app.post('/api/proctoring/frame', (req, res) => {
  const sessionId = req.session.testSession || req.body.sessionId;
  
  if (proctoringData[sessionId]) {
    // Store only last 10 frames to save memory
    if (proctoringData[sessionId].frames.length >= 10) {
      proctoringData[sessionId].frames.shift();
    }
    
    proctoringData[sessionId].frames.push({
      timestamp: new Date().toISOString(),
      frame: req.body.frame
    });
  }
  
  res.json({ success: true });
});

app.post('/api/proctoring/alert', (req, res) => {
  const sessionId = req.session.testSession || req.body.sessionId;
  
  if (proctoringData[sessionId]) {
    const alert = {
      timestamp: new Date().toISOString(),
      ...req.body
    };
    
    proctoringData[sessionId].alerts.push(alert);
    
    // Notify admin about alert
    io.to('admin-room').emit('proctoring-alert', {
      sessionId,
      alert,
      candidateName: activeTests[sessionId]?.candidateName
    });
  }
  
  res.json({ success: true });
});

// Get active test sessions (for admin monitoring)
app.get('/api/active-sessions', requireAdmin, (req, res) => {
  const activeSessions = Object.values(activeTests)
    .filter(session => session.status === 'in_progress')
    .map(session => ({
      sessionId: session.sessionId,
      candidateName: session.candidateName,
      candidateEmail: session.candidateEmail,
      testId: session.testId,
      startTime: session.startTime,
      tabSwitches: session.tabSwitches,
      violations: session.violations.length,
      answeredQuestions: Object.keys(session.answers).length
    }));
  
  res.json(activeSessions);
});

// Socket.IO for real-time monitoring
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join-monitoring', (data) => {
    if (data.role === 'admin') {
      socket.join('admin-room');
      console.log('Admin joined monitoring room');
      
      // Send all active sessions to the newly connected admin
      const activeSessions = Object.keys(activeTests)
        .filter(sessionId => activeTests[sessionId].status === 'in_progress')
        .map(sessionId => ({
          sessionId,
          session: {
            ...activeTests[sessionId],
            answers: undefined // Don't send answers yet
          }
        }));
      
      socket.emit('active-sessions', activeSessions);
      
    } else if (data.sessionId) {
      socket.join(`session-${data.sessionId}`);
      console.log(`Student joined session: ${data.sessionId}`);
      
      // Notify all admins about this student
      if (activeTests[data.sessionId]) {
        io.to('admin-room').emit('student-connected', {
          sessionId: data.sessionId,
          session: {
            candidateName: activeTests[data.sessionId].candidateName,
            candidateEmail: activeTests[data.sessionId].candidateEmail,
            testId: activeTests[data.sessionId].testId,
            startTime: activeTests[data.sessionId].startTime
          }
        });
      }
    }
  });
  
  socket.on('video-frame', (data) => {
    // Forward video frame to admin (throttled)
    io.to('admin-room').emit('student-video-frame', {
      sessionId: data.sessionId,
      frame: data.frame,
      timestamp: new Date().toISOString()
    });
  });
  
  socket.on('code-update', (data) => {
    // Store code snapshot
    const sessionId = data.sessionId;
    if (proctoringData[sessionId]) {
      proctoringData[sessionId].codeSnapshots.push({
        questionId: data.questionId,
        code: data.code,
        timestamp: new Date().toISOString()
      });
    }
    
    // Forward code updates to admin for live monitoring
    io.to('admin-room').emit('student-code-update', {
      sessionId: data.sessionId,
      code: data.code,
      questionId: data.questionId,
      timestamp: new Date().toISOString(),
      candidateName: activeTests[sessionId]?.candidateName
    });
  });
  
  socket.on('proctoring-alert', (data) => {
    // Forward AI alerts to admin
    io.to('admin-room').emit('proctoring-alert', {
      sessionId: data.sessionId,
      alert: data.alert,
      timestamp: new Date().toISOString(),
      candidateName: activeTests[data.sessionId]?.candidateName
    });
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/test.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

app.get('/monitor.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'monitor.html'));
});

app.get('/success.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    activeTests: Object.keys(activeTests).length,
    submissions: Object.keys(submissions).length
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║          🚀 Coding Test Platform Server                    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

✅ Server running on port ${PORT}
🌐 Admin Panel: http://localhost:${PORT}/admin.html
🔐 Default Credentials:
   Username: admin
   Password: admin123

📊 Endpoints:
   - GET  /api/health - Health check
   - POST /api/login - Admin login
   - GET  /api/tests - Get all tests
   - POST /api/tests - Create new test
   - POST /api/execute - Execute code
   - POST /api/execute/custom - Execute with custom input
   - GET  /api/active-sessions - Get active sessions
   - GET  /api/submissions - Get all submissions

🎯 Ready to accept test sessions!
  `);
});