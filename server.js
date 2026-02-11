require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
// Load environment variables from .env file


const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ============================================================================
// MONGODB CONNECTION
// ============================================================================
// Replace with your MongoDB Atlas connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/coding-test-platform';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ============================================================================
// MONGODB SCHEMAS - ONLY TEST DATA
// ============================================================================

// Test Schema
const testSchema = new mongoose.Schema({
  testId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  duration: { type: Number, required: true },
  instructions: String,
  questions: [{
    id: Number,
    title: String,
    description: String,
    template: String,
    mainTemplate: String,
    difficulty: String,
    visibleTestCases: [{
      input: String,
      output: String
    }],
    hiddenTestCases: [{
      input: String,
      output: String
    }]
  }],
  link: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
});

const Test = mongoose.model('Test', testSchema);

// Submission Schema - ONLY ESSENTIAL TEST DATA
const submissionSchema = new mongoose.Schema({
  submissionId: { type: String, required: true, unique: true },
  testId: { type: String, required: true },

  // Student Info
  candidateName: { type: String, required: true },
  candidateEmail: { type: String, required: true },

  // Test Timing
  startTime: { type: Date, required: true },
  endTime: Date,
  submittedAt: Date,

  // Question Answers
  answers: [{
    questionId: Number,
    code: String,
    language: String,
    submittedAt: Date,

    // Test Results
    visibleTestCasesPassed: { type: Number, default: 0 },
    visibleTestCasesTotal: { type: Number, default: 0 },
    hiddenTestCasesPassed: { type: Number, default: 0 },
    hiddenTestCasesTotal: { type: Number, default: 0 }
  }]
});

const Submission = mongoose.model('Submission', submissionSchema);

// Active Session Schema (temporary during test)
const activeSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  testId: { type: String, required: true },
  candidateName: { type: String, required: true },
  candidateEmail: { type: String, required: true },
  startTime: { type: Date, default: Date.now },

  // Current answers (gets moved to Submission on submit)
  answers: [{
    questionId: Number,
    code: String,
    language: String,
    submittedAt: Date,
    visibleTestCasesPassed: { type: Number, default: 0 },
    visibleTestCasesTotal: { type: Number, default: 0 },
    hiddenTestCasesPassed: { type: Number, default: 0 },
    hiddenTestCasesTotal: { type: Number, default: 0 }
  }]
});

const ActiveSession = mongoose.model('ActiveSession', activeSessionSchema);

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use(session({
  secret: 'coding-test-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// In-memory storage (only for users and proctoring display - NOT saved to DB)
const users = {
  admin: {
    username: 'Gorin',
    password: 'Gorin9056#',
    role: 'admin'
  }
};

// Proctoring data - ONLY for live monitoring, NOT saved to database
const proctoringCache = {};

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

// Smart output comparison
function compareOutputs(actual, expected) {
  const normalizeOutput = (str) => {
    if (!str) return '';
    return str
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, '\n');
  };

  const normalizedActual = normalizeOutput(actual);
  const normalizedExpected = normalizeOutput(expected);

  if (normalizedActual === normalizedExpected) return true;

  try {
    const actualParsed = JSON.parse(normalizedActual);
    const expectedParsed = JSON.parse(normalizedExpected);
    return JSON.stringify(actualParsed) === JSON.stringify(expectedParsed);
  } catch (e) { }

  try {
    const parseArray = (str) => {
      return str.replace(/[\[\]"']/g, '').split(',').map(s => s.trim()).filter(s => s.length > 0);
    };
    const actualArray = parseArray(normalizedActual);
    const expectedArray = parseArray(normalizedExpected);
    if (actualArray.length === expectedArray.length) {
      const matches = actualArray.every((val, idx) => val === expectedArray[idx]);
      if (matches) return true;
    }
  } catch (e) { }

  try {
    const actualNum = parseFloat(normalizedActual);
    const expectedNum = parseFloat(normalizedExpected);
    if (!isNaN(actualNum) && !isNaN(expectedNum)) {
      return Math.abs(actualNum - expectedNum) < 0.0001;
    }
  } catch (e) { }

  if (normalizedActual.toLowerCase() === normalizedExpected.toLowerCase()) return true;

  return actual.trim() === expected.trim();
}

// ============================================================================
// ROUTES
// ============================================================================

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

// Create Test
app.post('/api/tests', requireAdmin, async (req, res) => {
  try {
    const testId = uuidv4();
    const protocol = req.protocol;
    const host = req.get('host');
    const testLink = `${protocol}://${host}/test.html?id=${testId}`;

    const test = new Test({
      testId,
      title: req.body.title,
      duration: req.body.duration,
      instructions: req.body.instructions,
      questions: req.body.questions,
      link: testLink
    });

    await test.save();
    console.log('✅ Test saved to MongoDB:', testId);
    res.json({ success: true, test });
  } catch (error) {
    console.error('❌ Error creating test:', error);
    res.status(500).json({ error: 'Failed to create test' });
  }
});

// Get all tests
app.get('/api/tests', requireAdmin, async (req, res) => {
  try {
    const tests = await Test.find().sort({ createdAt: -1 });
    res.json(tests);
  } catch (error) {
    console.error('Error fetching tests:', error);
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

// Get single test
app.get('/api/tests/:id', async (req, res) => {
  try {
    const test = await Test.findOne({ testId: req.params.id });
    if (test) {
      res.json(test);
    } else {
      res.status(404).json({ error: 'Test not found' });
    }
  } catch (error) {
    console.error('Error fetching test:', error);
    res.status(500).json({ error: 'Failed to fetch test' });
  }
});

// Update test
app.patch('/api/tests/:id', requireAdmin, async (req, res) => {
  try {
    const test = await Test.findOne({ testId: req.params.id });
    if (test) {
      if (req.body.title) test.title = req.body.title;
      if (req.body.duration) test.duration = req.body.duration;
      if (req.body.instructions !== undefined) test.instructions = req.body.instructions;
      test.updatedAt = new Date();
      await test.save();
      res.json({ success: true, test });
    } else {
      res.status(404).json({ error: 'Test not found' });
    }
  } catch (error) {
    console.error('Error updating test:', error);
    res.status(500).json({ error: 'Failed to update test' });
  }
});

// Delete test
// Replace this in your server.js

// Delete test - FIXED VERSION
app.delete('/api/tests/:id', requireAdmin, async (req, res) => {
  try {
    const testId = req.params.id;
    console.log('🗑️ Attempting to delete test:', testId);

    // Find the test first to verify it exists
    const test = await Test.findOne({ testId: testId });

    if (!test) {
      console.log('❌ Test not found:', testId);
      return res.status(404).json({ error: 'Test not found' });
    }

    console.log('✅ Test found, deleting:', test.title);

    // Delete the test
    const result = await Test.deleteOne({ testId: testId });

    console.log('🗑️ Delete result:', result);

    if (result.deletedCount === 1) {
      console.log('✅ Test successfully deleted from database');
      res.json({ success: true, message: 'Test deleted successfully' });
    } else {
      console.log('⚠️ Delete operation completed but no document was deleted');
      res.status(500).json({ error: 'Failed to delete test' });
    }
  } catch (error) {
    console.error('❌ Error deleting test:', error);
    res.status(500).json({ error: 'Failed to delete test', message: error.message });
  }
});

// ============================================================================
// TEST SESSION ROUTES
// ============================================================================

// Start test session
app.post('/api/test-session/start', async (req, res) => {
  try {
    const { testId, candidateName, candidateEmail } = req.body;
    const test = await Test.findOne({ testId });

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    if (!candidateName || !candidateEmail) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const sessionId = uuidv4();
    const activeSession = new ActiveSession({
      sessionId,
      testId,
      candidateName,
      candidateEmail
    });

    await activeSession.save();
    console.log('✅ Session started:', sessionId, '-', candidateName);

    // Initialize proctoring cache (for live monitoring only)
    proctoringCache[sessionId] = {
      frames: [],
      alerts: []
    };

    req.session.testSession = sessionId;
    res.json({ success: true, sessionId, startTime: activeSession.startTime });
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// Save question answer
app.post('/api/test-session/save-answer', async (req, res) => {
  try {
    const sessionId = req.session.testSession || req.body.sessionId;
    const { questionId, code, language, testResults } = req.body;

    const session = await ActiveSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const existingAnswerIndex = session.answers.findIndex(a => a.questionId === questionId);

    const answerData = {
      questionId,
      code,
      language: language || 'java',
      submittedAt: new Date()
    };

    // Add test results if provided
    if (testResults) {
      answerData.visibleTestCasesPassed = testResults.visibleTestCasesPassed || 0;
      answerData.visibleTestCasesTotal = testResults.visibleTestCasesTotal || 0;
      answerData.hiddenTestCasesPassed = testResults.hiddenTestCasesPassed || 0;
      answerData.hiddenTestCasesTotal = testResults.hiddenTestCasesTotal || 0;
    }

    if (existingAnswerIndex >= 0) {
      // Update existing answer (overwrite)
      session.answers[existingAnswerIndex] = answerData;
    } else {
      // Add new answer
      session.answers.push(answerData);
    }

    await session.save();
    console.log('✅ Answer saved for question', questionId, '-', session.candidateName);

    res.json({ success: true, message: 'Answer saved successfully' });
  } catch (error) {
    console.error('Error saving answer:', error);
    res.status(500).json({ error: 'Failed to save answer' });
  }
});

// Submit entire test
app.post('/api/test-session/submit', async (req, res) => {
  try {
    const sessionId = req.session.testSession || req.body.sessionId;
    const { answers: clientAnswers } = req.body;

    const session = await ActiveSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const endTime = new Date();

    // Merge client answers with session answers
    if (clientAnswers) {
      for (const [qId, answer] of Object.entries(clientAnswers)) {
        const questionId = parseInt(qId);
        const existingIndex = session.answers.findIndex(a => a.questionId === questionId);

        if (existingIndex >= 0) {
          if (answer.code) {
            session.answers[existingIndex].code = answer.code;
            session.answers[existingIndex].language = answer.language || 'java';
          }
        } else {
          session.answers.push({
            questionId,
            code: answer.code,
            language: answer.language || 'java',
            submittedAt: endTime
          });
        }
      }
    }

    // Create submission record
    const submissionId = uuidv4();
    const submission = new Submission({
      submissionId,
      testId: session.testId,
      candidateName: session.candidateName,
      candidateEmail: session.candidateEmail,
      startTime: session.startTime,
      endTime,
      submittedAt: endTime,
      answers: session.answers
    });

    await submission.save();
    console.log('✅ Test submitted:', submissionId, '-', session.candidateName);

    // Delete active session
    await ActiveSession.deleteOne({ sessionId });

    // Clean up proctoring cache
    delete proctoringCache[sessionId];

    // Notify admin
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
  } catch (error) {
    console.error('Error submitting test:', error);
    res.status(500).json({ error: 'Failed to submit test' });
  }
});

// Get all submissions
app.get('/api/submissions', requireAdmin, async (req, res) => {
  try {
    const submissions = await Submission.find()
      .select('-answers.code') // Don't send full code in list view
      .sort({ submittedAt: -1 });

    const submissionList = submissions.map(sub => ({
      id: sub.submissionId,
      candidateName: sub.candidateName,
      candidateEmail: sub.candidateEmail,
      testId: sub.testId,
      startTime: sub.startTime,
      endTime: sub.endTime,
      submittedAt: sub.submittedAt,
      answeredQuestions: sub.answers.length,
      totalVisiblePassed: sub.answers.reduce((sum, a) => sum + (a.visibleTestCasesPassed || 0), 0),
      totalHiddenPassed: sub.answers.reduce((sum, a) => sum + (a.hiddenTestCasesPassed || 0), 0)
    }));

    res.json(submissionList);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Get single submission (with full code)
app.get('/api/submissions/:id', requireAdmin, async (req, res) => {
  try {
    const submission = await Submission.findOne({ submissionId: req.params.id });
    if (submission) {
      res.json(submission);
    } else {
      res.status(404).json({ error: 'Submission not found' });
    }
  } catch (error) {
    console.error('Error fetching submission:', error);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

// ============================================================================
// CODE EXECUTION
// ============================================================================

app.post('/api/execute', async (req, res) => {
  const { solutionCode, mainTemplate, testCases, language = 'java', questionId, sessionId } = req.body;

  if (!solutionCode || !testCases || testCases.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Solution code and test cases are required'
    });
  }

  try {
    const activeSessionId = req.session.testSession || sessionId;

    // Get hidden test cases from database
    let hiddenTestCases = [];
    if (activeSessionId && questionId) {
      const session = await ActiveSession.findOne({ sessionId: activeSessionId });
      if (session && session.testId) {
        const test = await Test.findOne({ testId: session.testId });
        if (test && test.questions) {
          const question = test.questions.find(q => q.id === questionId);
          if (question && question.hiddenTestCases) {
            hiddenTestCases = question.hiddenTestCases;
          }
        }
      }
    }

    const allTestCases = [...testCases, ...hiddenTestCases];
    const results = [];

    console.log(`\n🔄 Executing ${allTestCases.length} test cases (${testCases.length} visible, ${hiddenTestCases.length} hidden)`);

    // Execute code (Java only for now - can add Python/JS later)
    if (language === 'java') {
      for (let i = 0; i < allTestCases.length; i++) {
        const testCase = allTestCases[i];

        let allImports = new Set();
        const mainTemplateImports = (mainTemplate || '').match(/^import\s+.*?;\s*$/gm) || [];
        mainTemplateImports.forEach(imp => allImports.add(imp.trim()));
        const solutionImports = solutionCode.match(/^import\s+.*?;\s*$/gm) || [];
        solutionImports.forEach(imp => allImports.add(imp.trim()));
        const importsBlock = Array.from(allImports).join('\n') + (allImports.size > 0 ? '\n\n' : '');

        let cleanSolutionCode = solutionCode
          .replace(/^import\s+.*?;\s*$/gm, '')
          .replace(/public\s+class\s+Solution\s*\{/g, '')
          .replace(/class\s+Solution\s*\{/g, '')
          .replace(/public\s+static\s+void\s+main\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/gm, '')
          .trim();

        if (cleanSolutionCode.endsWith('}')) {
          const openBraces = (cleanSolutionCode.match(/\{/g) || []).length;
          const closeBraces = (cleanSolutionCode.match(/\}/g) || []).length;
          if (closeBraces > openBraces) {
            cleanSolutionCode = cleanSolutionCode.substring(0, cleanSolutionCode.lastIndexOf('}')).trim();
          }
        }

        if (!cleanSolutionCode || cleanSolutionCode === '' || cleanSolutionCode === '}') {
          results.push({
            testCase: i + 1,
            input: testCase.input,
            expectedOutput: testCase.output,
            actualOutput: '',
            passed: false,
            error: 'Solution code is empty!',
            executionTime: 0,
            status: 'error'
          });
          continue;
        }

        let cleanMainTemplate = (mainTemplate || '')
          .replace(/^import\s+.*?;\s*$/gm, '')
          .replace(/public\s+class\s+Main\s*\{/g, '')
          .replace(/class\s+Main\s*\{/g, '')
          .trim();

        const mainMethodMatch = cleanMainTemplate.match(/public\s+static\s+void\s+main\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
        if (mainMethodMatch) {
          cleanMainTemplate = mainMethodMatch[1].trim();
        }

        while (cleanMainTemplate.endsWith('}') && !cleanMainTemplate.includes('{')) {
          cleanMainTemplate = cleanMainTemplate.substring(0, cleanMainTemplate.lastIndexOf('}')).trim();
        }

        let processedInput = testCase.input.trim();
        if (!processedInput.includes(',') && !processedInput.includes('[') && !processedInput.includes('{') && processedInput.includes(' ')) {
          processedInput = processedInput.split(/\s+/).join(', ');
        }

        const mainCodeWithInput = cleanMainTemplate.replace(/\{\{input\}\}/g, processedInput);

        const indentedSolution = cleanSolutionCode.split('\n').map(line => '    ' + line).join('\n');
        const indentedMainCode = mainCodeWithInput.split('\n').map(line => '        ' + line).join('\n');

        const fullCode = `${importsBlock}public class Main {
    public static void main(String[] args) {
${indentedMainCode}
    }
}

class Solution {
${indentedSolution}
}`;

        const startTime = Date.now();

        try {
          const response = await fetch('https://emkc.org/api/v2/piston/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              language: 'java',
              version: '15.0.2',
              files: [{ name: 'Main.java', content: fullCode }]
            })
          });

          if (!response.ok) throw new Error(`Execution service error: ${response.statusText}`);

          const result = await response.json();
          const executionTime = Date.now() - startTime;

          if (result.compile && result.compile.stderr) {
            results.push({
              testCase: i + 1,
              input: testCase.input,
              expectedOutput: testCase.output,
              actualOutput: '',
              passed: false,
              error: 'Compilation Error: ' + result.compile.stderr.substring(0, 300),
              executionTime,
              status: 'compilation_error'
            });
            continue;
          }

          const output = (result.run?.stdout || '').trim();
          const stderr = result.run?.stderr || '';
          const passed = compareOutputs(output, testCase.output);

          results.push({
            testCase: i + 1,
            input: testCase.input,
            expectedOutput: testCase.output,
            actualOutput: output,
            passed,
            error: stderr || null,
            executionTime,
            status: passed ? 'passed' : 'failed'
          });

        } catch (error) {
          results.push({
            testCase: i + 1,
            input: testCase.input,
            expectedOutput: testCase.output,
            actualOutput: '',
            passed: false,
            error: error.message,
            executionTime: 0,
            status: 'error'
          });
        }
      }
    } else {
      return res.status(400).json({
        success: false,
        error: `Language ${language} not yet supported. Only Java is available.`
      });
    }

    // Separate visible and hidden results
    const visibleResults = results.slice(0, testCases.length);
    const hiddenResults = results.slice(testCases.length);

    const visiblePassed = visibleResults.filter(r => r.passed).length;
    const hiddenPassed = hiddenResults.filter(r => r.passed).length;
    const totalPassed = visiblePassed + hiddenPassed;

    console.log(`✅ Results: ${totalPassed}/${results.length} passed (${visiblePassed}/${testCases.length} visible, ${hiddenPassed}/${hiddenTestCases.length} hidden)`);

    res.json({
      success: true,
      visibleResults,
      hiddenResults,
      summary: {
        total: results.length,
        passed: totalPassed,
        failed: results.length - totalPassed,
        allPassed: totalPassed === results.length,
        percentage: results.length > 0 ? ((totalPassed / results.length) * 100).toFixed(2) : 0,
        visiblePassed,
        visibleTotal: testCases.length,
        hiddenPassed,
        hiddenTotal: hiddenTestCases.length
      }
    });

  } catch (error) {
    console.error('❌ Code execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Code execution failed',
      message: error.message
    });
  }
});

// ============================================================================
// SOCKET.IO - REAL-TIME MONITORING (proctoring in memory only, not saved)
// ============================================================================

io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  socket.on('join-monitoring', async (data) => {
    if (data.role === 'admin') {
      socket.join('admin-room');
      const activeSessions = await ActiveSession.find();
      const sessionData = activeSessions.map(session => ({
        sessionId: session.sessionId,
        session: {
          candidateName: session.candidateName,
          candidateEmail: session.candidateEmail,
          testId: session.testId,
          startTime: session.startTime
        }
      }));
      socket.emit('active-sessions', sessionData);
    } else if (data.sessionId) {
      socket.join(`session-${data.sessionId}`);
      const session = await ActiveSession.findOne({ sessionId: data.sessionId });
      if (session) {
        io.to('admin-room').emit('student-connected', {
          sessionId: data.sessionId,
          session: {
            candidateName: session.candidateName,
            candidateEmail: session.candidateEmail,
            testId: session.testId,
            startTime: session.startTime
          }
        });
      }
    }
  });

  socket.on('video-frame', (data) => {
    // Store in memory cache for live viewing only
    if (proctoringCache[data.sessionId]) {
      proctoringCache[data.sessionId].frames.push({
        frame: data.frame,
        timestamp: new Date().toISOString()
      });
      if (proctoringCache[data.sessionId].frames.length > 20) {
        proctoringCache[data.sessionId].frames.shift();
      }
    }
    // Send to admin for live monitoring
    io.to('admin-room').emit('student-video-frame', {
      sessionId: data.sessionId,
      frame: data.frame,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('code-update', (data) => {
    // Just forward to admin for live monitoring (not saved)
    io.to('admin-room').emit('student-code-update', {
      sessionId: data.sessionId,
      code: data.code,
      questionId: data.questionId,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('proctoring-alert', (data) => {
    // Store in memory cache for live viewing only
    if (proctoringCache[data.sessionId]) {
      proctoringCache[data.sessionId].alerts.push(data.alert);
    }
    // Send to admin for live monitoring
    io.to('admin-room').emit('proctoring-alert', {
      sessionId: data.sessionId,
      alert: data.alert,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ============================================================================
// SERVE HTML PAGES
// ============================================================================

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

app.get('/api/health', async (req, res) => {
  try {
    const activeSessionsCount = await ActiveSession.countDocuments();
    const submissionsCount = await Submission.countDocuments();
    const testsCount = await Test.countDocuments();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      activeSessions: activeSessionsCount,
      totalSubmissions: submissionsCount,
      totalTests: testsCount
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║      🚀 Coding Test Platform - FIXED VERSION! ✅            ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

✅ Server running on port ${PORT}
🌐 Admin Panel: http://localhost:${PORT}/admin.html
🔐 Default Credentials: admin / admin123

✅ WHAT'S SAVED TO MONGODB:
   📝 Tests (title, questions, test cases)
   👤 Student info (name, email)
   💻 Student code (for each question)
   ⏰ Submission times
   ✅ Test results (visible/hidden pass counts)
   
💾 Database: ${MONGODB_URI.includes('mongodb+srv') ? 'MongoDB Atlas (Cloud)' : 'Local MongoDB'}
🎯 Ready to track test submissions!
  `);
});