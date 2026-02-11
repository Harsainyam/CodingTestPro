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
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/coding-test-platform';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ============================================================================
// MONGODB SCHEMAS
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

// Student Schema
const studentSchema = new mongoose.Schema({
  studentId: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  testId: { type: String, required: true },
  hasCompletedTest: { type: Boolean, default: false },
  submissionId: { type: String },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String, default: 'admin' }
});

const Student = mongoose.model('Student', studentSchema);

// Submission Schema
const submissionSchema = new mongoose.Schema({
  submissionId: { type: String, required: true, unique: true },
  testId: { type: String, required: true },
  studentId: { type: String },
  candidateName: { type: String, required: true },
  candidateEmail: { type: String, required: true },
  startTime: { type: Date, required: true },
  endTime: Date,
  submittedAt: Date,
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

const Submission = mongoose.model('Submission', submissionSchema);

// Active Session Schema
const activeSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  testId: { type: String, required: true },
  studentId: { type: String, required: true },
  candidateName: { type: String, required: true },
  candidateEmail: { type: String, required: true },
  startTime: { type: Date, default: Date.now },
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

// In-memory storage for proctoring
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
// AUTHENTICATION ROUTES
// ============================================================================

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'Gorin' && password === 'Gorin9056#') {
    req.session.user = { username: 'admin', role: 'admin' };
    res.json({ success: true, role: 'admin' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/student/login', async (req, res) => {
  try {
    const { email, password, testId } = req.body;

    if (!email || !password || !testId) {
      return res.status(400).json({ error: 'Email, password, and test ID are required' });
    }

    const student = await Student.findOne({
      email: email.toLowerCase().trim(),
      password: password,
      testId: testId
    });

    if (!student) {
      return res.status(401).json({ error: 'Invalid credentials or not authorized for this test' });
    }

    if (student.hasCompletedTest) {
      return res.status(403).json({
        error: 'Test already completed',
        message: 'You have already submitted this test. You cannot take it again.',
        submissionId: student.submissionId
      });
    }

    req.session.student = {
      studentId: student.studentId,
      email: student.email,
      name: student.name,
      testId: student.testId
    };

    res.json({
      success: true,
      student: {
        name: student.name,
        email: student.email,
        testId: student.testId
      }
    });
  } catch (error) {
    console.error('❌ Student login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/check-auth', (req, res) => {
  if (req.session.user) {
    res.json({ authenticated: true, role: req.session.user.role });
  } else if (req.session.student) {
    res.json({ authenticated: true, role: 'student', student: req.session.student });
  } else {
    res.json({ authenticated: false });
  }
});

// ============================================================================
// STUDENT MANAGEMENT ROUTES
// ============================================================================

app.post('/api/students', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, testId } = req.body;

    if (!name || !email || !password || !testId) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const test = await Test.findOne({ testId });
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const existingStudent = await Student.findOne({
      email: email.toLowerCase().trim()
    });

    if (existingStudent) {
      return res.status(400).json({ error: 'Student with this email already exists' });
    }

    const studentId = uuidv4();
    const student = new Student({
      studentId,
      name,
      email: email.toLowerCase().trim(),
      password,
      testId
    });

    await student.save();
    console.log('✅ Student created:', email, 'for test:', test.title);

    res.json({
      success: true,
      student: {
        studentId: student.studentId,
        name: student.name,
        email: student.email,
        testId: student.testId,
        testTitle: test.title,
        createdAt: student.createdAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating student:', error);
    res.status(500).json({ error: 'Failed to create student' });
  }
});

app.get('/api/students', requireAdmin, async (req, res) => {
  try {
    const students = await Student.find().sort({ createdAt: -1 });
    
    const studentsWithTests = await Promise.all(students.map(async (student) => {
      const test = await Test.findOne({ testId: student.testId });
      return {
        studentId: student.studentId,
        name: student.name,
        email: student.email,
        testId: student.testId,
        testTitle: test ? test.title : 'Test not found',
        hasCompletedTest: student.hasCompletedTest,
        submissionId: student.submissionId,
        createdAt: student.createdAt
      };
    }));

    res.json(studentsWithTests);
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

app.delete('/api/students/:studentId', requireAdmin, async (req, res) => {
  try {
    const result = await Student.deleteOne({ studentId: req.params.studentId });
    
    if (result.deletedCount === 1) {
      res.json({ success: true, message: 'Student deleted successfully' });
    } else {
      res.status(404).json({ error: 'Student not found' });
    }
  } catch (error) {
    console.error('❌ Error deleting student:', error);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// ============================================================================
// TEST ROUTES
// ============================================================================

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

app.get('/api/tests', requireAdmin, async (req, res) => {
  try {
    const tests = await Test.find().sort({ createdAt: -1 });
    res.json(tests);
  } catch (error) {
    console.error('Error fetching tests:', error);
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

app.get('/api/tests/:id', async (req, res) => {
  try {
    if (!req.session.student || req.session.student.testId !== req.params.id) {
      return res.status(403).json({ error: 'Not authorized to access this test' });
    }

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

app.delete('/api/tests/:id', requireAdmin, async (req, res) => {
  try {
    const testId = req.params.id;
    const result = await Test.deleteOne({ testId: testId });

    if (result.deletedCount === 1) {
      res.json({ success: true, message: 'Test deleted successfully' });
    } else {
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

app.post('/api/test-session/start', async (req, res) => {
  try {
    const { testId } = req.body;
    
    if (!req.session.student || req.session.student.testId !== testId) {
      return res.status(403).json({ error: 'Not authorized to take this test. Please login first.' });
    }

    const test = await Test.findOne({ testId });
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const student = await Student.findOne({ studentId: req.session.student.studentId });
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (student.hasCompletedTest) {
      return res.status(403).json({
        error: 'Test already completed',
        message: 'You have already submitted this test.',
        submissionId: student.submissionId
      });
    }

    const sessionId = uuidv4();
    const activeSession = new ActiveSession({
      sessionId,
      testId,
      studentId: student.studentId,
      candidateName: student.name,
      candidateEmail: student.email
    });

    await activeSession.save();
    console.log('✅ Session started:', sessionId, '-', student.name);

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

    if (testResults) {
      answerData.visibleTestCasesPassed = testResults.visibleTestCasesPassed || 0;
      answerData.visibleTestCasesTotal = testResults.visibleTestCasesTotal || 0;
      answerData.hiddenTestCasesPassed = testResults.hiddenTestCasesPassed || 0;
      answerData.hiddenTestCasesTotal = testResults.hiddenTestCasesTotal || 0;
    }

    if (existingAnswerIndex >= 0) {
      session.answers[existingAnswerIndex] = answerData;
    } else {
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

app.post('/api/test-session/submit', async (req, res) => {
  try {
    const sessionId = req.session.testSession || req.body.sessionId;
    const { answers: clientAnswers } = req.body;

    const session = await ActiveSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const endTime = new Date();

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

    const submissionId = uuidv4();
    const submission = new Submission({
      submissionId,
      testId: session.testId,
      studentId: session.studentId,
      candidateName: session.candidateName,
      candidateEmail: session.candidateEmail,
      startTime: session.startTime,
      endTime,
      submittedAt: endTime,
      answers: session.answers
    });

    await submission.save();
    console.log('✅ Test submitted:', submissionId, '-', session.candidateName);

    await Student.updateOne(
      { studentId: session.studentId },
      {
        hasCompletedTest: true,
        submissionId: submissionId
      }
    );

    await ActiveSession.deleteOne({ sessionId });
    delete proctoringCache[sessionId];
    req.session.testSession = null;
    req.session.student = null;

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

app.get('/api/submissions', requireAdmin, async (req, res) => {
  try {
    const submissions = await Submission.find()
      .select('-answers.code')
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
// CODE EXECUTION - NEW STDIN-BASED APPROACH
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

    if (language === 'java') {
      for (let i = 0; i < allTestCases.length; i++) {
        const testCase = allTestCases[i];

        // Extract imports from both solution and main template
        let allImports = new Set();
        const mainTemplateImports = (mainTemplate || '').match(/^import\s+.*?;\s*$/gm) || [];
        mainTemplateImports.forEach(imp => allImports.add(imp.trim()));
        const solutionImports = solutionCode.match(/^import\s+.*?;\s*$/gm) || [];
        solutionImports.forEach(imp => allImports.add(imp.trim()));
        const importsBlock = Array.from(allImports).join('\n') + (allImports.size > 0 ? '\n\n' : '');

        // Clean solution code (remove imports, class wrapper, main method)
        let cleanSolutionCode = solutionCode
          .replace(/^import\s+.*?;\s*$/gm, '')
          .replace(/public\s+class\s+Solution\s*\{/g, '')
          .replace(/class\s+Solution\s*\{/g, '')
          .replace(/public\s+static\s+void\s+main\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/gm, '')
          .trim();

        // Remove extra closing brace if present
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

        // Clean main template (remove imports, class wrapper)
        let cleanMainTemplate = (mainTemplate || '')
          .replace(/^import\s+.*?;\s*$/gm, '')
          .replace(/public\s+class\s+Main\s*\{/g, '')
          .replace(/class\s+Main\s*\{/g, '')
          .trim();

        // Extract main method content
        const mainMethodMatch = cleanMainTemplate.match(/public\s+static\s+void\s+main\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
        if (mainMethodMatch) {
          cleanMainTemplate = mainMethodMatch[1].trim();
        }

        // Remove any trailing braces
        while (cleanMainTemplate.endsWith('}') && !cleanMainTemplate.includes('{')) {
          cleanMainTemplate = cleanMainTemplate.substring(0, cleanMainTemplate.lastIndexOf('}')).trim();
        }

        // Indent student code and main code
        const indentedSolution = cleanSolutionCode.split('\n').map(line => '    ' + line).join('\n');
        const indentedMainCode = cleanMainTemplate.split('\n').map(line => '        ' + line).join('\n');

        // Build complete Java file
        const fullCode = `${importsBlock}public class Main {
    // Student's functions/methods
${indentedSolution}

    // Test execution code
    public static void main(String[] args) {
${indentedMainCode}
    }
}`;

        const startTime = Date.now();

        try {
          // ✅ USE STDIN - Send test input directly via stdin
          const response = await fetch('https://emkc.org/api/v2/piston/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              language: 'java',
              version: '15.0.2',
              files: [{ name: 'Main.java', content: fullCode }],
              stdin: testCase.input  // ✅ Pass input directly to Scanner!
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
// SOCKET.IO
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
    if (proctoringCache[data.sessionId]) {
      proctoringCache[data.sessionId].frames.push({
        frame: data.frame,
        timestamp: new Date().toISOString()
      });
      if (proctoringCache[data.sessionId].frames.length > 20) {
        proctoringCache[data.sessionId].frames.shift();
      }
    }
    io.to('admin-room').emit('student-video-frame', {
      sessionId: data.sessionId,
      frame: data.frame,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('code-update', (data) => {
    io.to('admin-room').emit('student-code-update', {
      sessionId: data.sessionId,
      code: data.code,
      questionId: data.questionId,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('proctoring-alert', (data) => {
    if (proctoringCache[data.sessionId]) {
      proctoringCache[data.sessionId].alerts.push(data.alert);
    }
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
    const studentsCount = await Student.countDocuments();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      activeSessions: activeSessionsCount,
      totalSubmissions: submissionsCount,
      totalTests: testsCount,
      totalStudents: studentsCount
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
║   🚀 Coding Test Platform - STDIN VERSION                 ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

✅ Server running on port ${PORT}
🌐 Admin Panel: http://localhost:${PORT}/admin.html
🔐 Admin Credentials: Gorin / Gorin9056#

✨ NEW: DIRECT SCANNER SUPPORT VIA STDIN
   
📝 HOW IT WORKS:
   1. Write your main code with Scanner as usual
   2. Add test inputs as plain text (e.g., "5" or "hello")
   3. Scanner reads from stdin automatically!
   
💡 EXAMPLE:
   Main Template:
   Scanner sc = new Scanner(System.in);
   int n = sc.nextInt();
   Solution sol = new Solution();
   System.out.println(sol.factorial(n));
   
   Test Input: 5
   (Scanner reads "5" from stdin)
   
💾 Database: ${MONGODB_URI.includes('mongodb+srv') ? 'MongoDB Atlas (Cloud)' : 'Local MongoDB'}
🎯 Ready for testing!
  `);
});