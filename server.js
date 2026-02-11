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
  cookie: { secure: false }
}));

// In-memory storage
const users = {
  admin: {
    username: 'admin',
    password: 'admin123',
    role: 'admin'
  }
};

const tests = {};
const submissions = {};
const activeTests = {};
const proctoringData = {};

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

  if (normalizedActual === normalizedExpected) {
    return true;
  }

  try {
    const actualParsed = JSON.parse(normalizedActual);
    const expectedParsed = JSON.parse(normalizedExpected);
    return JSON.stringify(actualParsed) === JSON.stringify(expectedParsed);
  } catch (e) { }

  try {
    const parseArray = (str) => {
      return str
        .replace(/[\[\]"']/g, '')
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
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

  if (normalizedActual.toLowerCase() === normalizedExpected.toLowerCase()) {
    return true;
  }

  return actual.trim() === expected.trim();
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

app.post('/api/tests', requireAdmin, (req, res) => {
  const testId = uuidv4();
  const protocol = req.protocol;
  const host = req.get('host');
  const testLink = `${protocol}://${host}/test.html?id=${testId}`;

  const test = {
    id: testId,
    ...req.body,
    createdAt: new Date().toISOString(),
    link: testLink
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
    res.json(test);
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

  const startTime = new Date(session.startTime);
  const endTime = new Date(session.endTime);
  session.duration = Math.floor((endTime - startTime) / 1000);

  const submissionId = uuidv4();
  submissions[submissionId] = {
    id: submissionId,
    ...session,
    proctoringData: proctoringData[sessionId],
    submittedAt: session.endTime
  };

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

// COMPLETELY FIXED: Multi-language code execution with proper template handling
app.post('/api/execute', async (req, res) => {
  const { solutionCode, mainTemplate, testCases, language = 'java', questionId } = req.body;

  if (!solutionCode || !testCases || testCases.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Solution code and test cases are required'
    });
  }

  try {
    // Get hidden test cases
    const sessionId = req.session.testSession || req.body.sessionId;
    const session = activeTests[sessionId];

    let hiddenTestCases = [];
    if (session && session.testId && questionId) {
      const test = tests[session.testId];
      if (test && test.questions) {
        const question = test.questions.find(q => q.id === questionId);
        if (question && question.hiddenTestCases) {
          hiddenTestCases = question.hiddenTestCases;
        }
      }
    }

    const allTestCases = [...testCases, ...hiddenTestCases];
    const results = [];

    console.log(`\n🔄 Executing ${allTestCases.length} test cases (${testCases.length} visible, ${hiddenTestCases.length} hidden)`);
    console.log(`📝 Language: ${language}`);

    // Language-specific execution
    if (language === 'java') {
      // ===== JAVA EXECUTION - COMPLETELY FIXED =====
      for (let i = 0; i < allTestCases.length; i++) {
        const testCase = allTestCases[i];

        // Step 1: Extract ALL imports from both solution and main template
        let allImports = new Set();
        
        // Get imports from main template
        const mainTemplateImports = (mainTemplate || '').match(/^import\s+.*?;\s*$/gm) || [];
        mainTemplateImports.forEach(imp => allImports.add(imp.trim()));
        
        // Get imports from solution code
        const solutionImports = solutionCode.match(/^import\s+.*?;\s*$/gm) || [];
        solutionImports.forEach(imp => allImports.add(imp.trim()));
        
        const importsBlock = Array.from(allImports).join('\n') + (allImports.size > 0 ? '\n\n' : '');

        // Step 2: Clean solution code - remove imports and any class/main declarations
        let cleanSolutionCode = solutionCode
          .replace(/^import\s+.*?;\s*$/gm, '')  // Remove imports
          .replace(/public\s+class\s+Solution\s*\{/g, '')  // Remove public class Solution {
          .replace(/class\s+Solution\s*\{/g, '')  // Remove class Solution {
          .replace(/public\s+static\s+void\s+main\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/gm, '')  // Remove any main methods
          .trim();
        
        // Remove trailing closing brace if it's a leftover from class wrapper
        if (cleanSolutionCode.endsWith('}')) {
          // Count braces to see if we have an extra one
          const openBraces = (cleanSolutionCode.match(/\{/g) || []).length;
          const closeBraces = (cleanSolutionCode.match(/\}/g) || []).length;
          if (closeBraces > openBraces) {
            cleanSolutionCode = cleanSolutionCode.substring(0, cleanSolutionCode.lastIndexOf('}')).trim();
          }
        }
        
        // Validation: Check if solution code is essentially empty
        if (!cleanSolutionCode || cleanSolutionCode === '' || cleanSolutionCode === '}') {
          console.log(`   ❌ ERROR: Solution code is empty or invalid!`);
          console.log(`   Original solution code: "${solutionCode}"`);
          console.log(`   Cleaned solution code: "${cleanSolutionCode}"`);
          
          results.push({
            testCase: i + 1,
            input: testCase.input,
            expectedOutput: testCase.output,
            actualOutput: '',
            passed: false,
            error: 'Student solution code is empty! Please write your solution in the code editor.',
            executionTime: 0,
            status: 'error'
          });
          continue;
        }

        // Step 3: Clean main template - remove imports and ensure it's just the main method body
        let cleanMainTemplate = (mainTemplate || '')
          .replace(/^import\s+.*?;\s*$/gm, '')  // Remove imports
          .replace(/public\s+class\s+Main\s*\{/g, '')  // Remove public class Main {
          .replace(/class\s+Main\s*\{/g, '')  // Remove class Main {
          .trim();
        
        // If main template already has main method wrapper, extract just the body
        const mainMethodMatch = cleanMainTemplate.match(/public\s+static\s+void\s+main\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
        if (mainMethodMatch) {
          cleanMainTemplate = mainMethodMatch[1].trim();
        }
        
        // Remove trailing closing braces
        while (cleanMainTemplate.endsWith('}') && !cleanMainTemplate.includes('{')) {
          cleanMainTemplate = cleanMainTemplate.substring(0, cleanMainTemplate.lastIndexOf('}')).trim();
        }

        // Step 4: Replace {{input}} placeholder in main template
        // Clean up the input: if it looks like multiple params separated by space, add commas
        let processedInput = testCase.input.trim();
        
        // If input doesn't have commas but has spaces, it might need commas
        // E.g., "2 3" should become "2, 3" for method calls
        // BUT "new int[]{1 2 3}" should NOT be changed
        // So only fix if it's simple arguments (no brackets)
        if (!processedInput.includes(',') && 
            !processedInput.includes('[') && 
            !processedInput.includes('{') &&
            processedInput.includes(' ')) {
          // Multiple space-separated values without commas - add commas
          processedInput = processedInput.split(/\s+/).join(', ');
        }
        
        const mainCodeWithInput = cleanMainTemplate.replace(/\{\{input\}\}/g, processedInput);

        // Step 5: Construct the final Java file with proper structure
        // Indent the solution code properly
        const indentedSolution = cleanSolutionCode
          .split('\n')
          .map(line => '    ' + line)
          .join('\n');
        
        // Indent the main code properly
        const indentedMainCode = mainCodeWithInput
          .split('\n')
          .map(line => '        ' + line)
          .join('\n');
        
        const fullCode = `${importsBlock}class Solution {
${indentedSolution}
}

public class Main {
    public static void main(String[] args) {
${indentedMainCode}
    }
}`;

        console.log(`\n📌 Test Case ${i + 1}:`);
        console.log(`   Input: ${testCase.input}`);
        console.log(`   Expected: ${testCase.output}`);

        // Log the actual code being executed (for debugging first test case only)
        if (i === 0) {
          console.log('\n' + '='.repeat(80));
          console.log('📄 DEBUGGING - CODE GENERATION STEPS:');
          console.log('='.repeat(80));
          console.log('\n1️⃣ ORIGINAL SOLUTION CODE:');
          console.log('---START---');
          console.log(solutionCode);
          console.log('---END---');
          
          console.log('\n2️⃣ ORIGINAL MAIN TEMPLATE:');
          console.log('---START---');
          console.log(mainTemplate);
          console.log('---END---');
          
          console.log('\n3️⃣ CLEANED SOLUTION CODE:');
          console.log('---START---');
          console.log(cleanSolutionCode);
          console.log('---END---');
          
          console.log('\n4️⃣ CLEANED MAIN TEMPLATE:');
          console.log('---START---');
          console.log(cleanMainTemplate);
          console.log('---END---');
          
          console.log('\n🔧 INPUT PROCESSING:');
          console.log(`Original input: "${testCase.input}"`);
          console.log(`Processed input: "${processedInput}"`);
          
          console.log('\n5️⃣ MAIN CODE WITH INPUT REPLACED:');
          console.log('---START---');
          console.log(mainCodeWithInput);
          console.log('---END---');
          
          console.log('\n6️⃣ FINAL GENERATED JAVA CODE:');
          console.log('---START---');
          console.log(fullCode);
          console.log('---END---');
          console.log('='.repeat(80) + '\n');
        }

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
            console.log(`   ❌ Compilation Error`);
            console.log(result.compile.stderr);
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

          console.log(`   ${passed ? '✅' : '❌'} Got: ${output}`);

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
          console.log(`   ❌ Error: ${error.message}`);
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
    }
    else if (language === 'python') {
      // ===== PYTHON EXECUTION =====
      for (let i = 0; i < allTestCases.length; i++) {
        const testCase = allTestCases[i];

        // Replace {{input}} in main template
        let mainCode = mainTemplate || `result = solution({{input}})
print(result)`;
        mainCode = mainCode.replace(/\{\{input\}\}/g, testCase.input);

        const pythonCode = `${solutionCode}\n\n${mainCode}`;

        console.log(`\n📌 Test Case ${i + 1}:`);
        console.log(`   Input: ${testCase.input}`);

        const startTime = Date.now();

        try {
          const response = await fetch('https://emkc.org/api/v2/piston/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              language: 'python',
              version: '3.10.0',
              files: [{ name: 'solution.py', content: pythonCode }]
            })
          });

          const result = await response.json();
          const executionTime = Date.now() - startTime;
          const output = (result.run?.stdout || '').trim();
          const stderr = result.run?.stderr || '';
          const passed = compareOutputs(output, testCase.output);

          console.log(`   ${passed ? '✅' : '❌'} Got: ${output}`);

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
          console.log(`   ❌ Error: ${error.message}`);
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

    } else if (language === 'javascript') {
      // ===== JAVASCRIPT EXECUTION =====
      for (let i = 0; i < allTestCases.length; i++) {
        const testCase = allTestCases[i];

        // Replace {{input}} in main template
        let mainCode = mainTemplate || `const result = solution({{input}});
console.log(JSON.stringify(result));`;
        mainCode = mainCode.replace(/\{\{input\}\}/g, testCase.input);

        const jsCode = `${solutionCode}\n\n${mainCode}`;

        console.log(`\n📌 Test Case ${i + 1}:`);
        console.log(`   Input: ${testCase.input}`);

        const startTime = Date.now();

        try {
          const response = await fetch('https://emkc.org/api/v2/piston/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              language: 'javascript',
              version: '18.15.0',
              files: [{ name: 'solution.js', content: jsCode }]
            })
          });

          const result = await response.json();
          const executionTime = Date.now() - startTime;
          const output = (result.run?.stdout || '').trim();
          const stderr = result.run?.stderr || '';
          const passed = compareOutputs(output, testCase.output);

          console.log(`   ${passed ? '✅' : '❌'} Got: ${output}`);

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
          console.log(`   ❌ Error: ${error.message}`);
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
        error: `Unsupported language: ${language}`
      });
    }

    // Separate visible and hidden results
    const visibleResults = results.slice(0, testCases.length);
    const hiddenResults = results.slice(testCases.length);

    const visiblePassed = visibleResults.filter(r => r.passed).length;
    const hiddenPassed = hiddenResults.filter(r => r.passed).length;
    const totalPassed = visiblePassed + hiddenPassed;

    console.log(`\n✅ Results: ${totalPassed}/${results.length} passed (${visiblePassed}/${testCases.length} visible, ${hiddenPassed}/${hiddenTestCases.length} hidden)\n`);

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
        hiddenPassed
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

// Socket.IO for real-time monitoring
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  socket.on('join-monitoring', (data) => {
    if (data.role === 'admin') {
      socket.join('admin-room');

      const activeSessions = Object.keys(activeTests)
        .filter(sessionId => activeTests[sessionId].status === 'in_progress')
        .map(sessionId => ({
          sessionId,
          session: {
            candidateName: activeTests[sessionId].candidateName,
            candidateEmail: activeTests[sessionId].candidateEmail,
            testId: activeTests[sessionId].testId,
            startTime: activeTests[sessionId].startTime
          }
        }));

      socket.emit('active-sessions', activeSessions);

    } else if (data.sessionId) {
      socket.join(`session-${data.sessionId}`);

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
    // Store frame in proctoring data
    if (proctoringData[data.sessionId]) {
      proctoringData[data.sessionId].frames.push({
        frame: data.frame,
        timestamp: new Date().toISOString()
      });
      // Keep only last 50 frames to save memory
      if (proctoringData[data.sessionId].frames.length > 50) {
        proctoringData[data.sessionId].frames.shift();
      }
    }

    io.to('admin-room').emit('student-video-frame', {
      sessionId: data.sessionId,
      frame: data.frame,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('code-update', (data) => {
    const sessionId = data.sessionId;
    if (proctoringData[sessionId]) {
      proctoringData[sessionId].codeSnapshots.push({
        questionId: data.questionId,
        code: data.code,
        timestamp: new Date().toISOString()
      });
    }

    io.to('admin-room').emit('student-code-update', {
      sessionId: data.sessionId,
      code: data.code,
      questionId: data.questionId,
      timestamp: new Date().toISOString(),
      candidateName: activeTests[sessionId]?.candidateName
    });
  });

  socket.on('proctoring-alert', (data) => {
    const sessionId = data.sessionId;

    // Store alert
    if (activeTests[sessionId]) {
      activeTests[sessionId].violations.push(data.alert);

      if (data.alert.type === 'tab_switch') {
        activeTests[sessionId].tabSwitches = (activeTests[sessionId].tabSwitches || 0) + 1;
      }
    }

    if (proctoringData[sessionId]) {
      proctoringData[sessionId].alerts.push(data.alert);
    }

    io.to('admin-room').emit('proctoring-alert', {
      sessionId: data.sessionId,
      alert: data.alert,
      timestamp: new Date().toISOString(),
      candidateName: activeTests[data.sessionId]?.candidateName
    });
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
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

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeTests: Object.keys(activeTests).length,
    submissions: Object.keys(submissions).length,
    activeSessions: Object.values(activeTests).filter(t => t.status === 'in_progress').length
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║        🚀 Coding Test Platform Server (FIXED!)             ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

✅ Server running on port ${PORT}
🌐 Admin Panel: http://localhost:${PORT}/admin.html
🔐 Default Credentials: admin / admin123

✅ JAVA EXECUTION FIX APPLIED:
   ✅ Solution class methods extracted cleanly
   ✅ Main template body isolated properly
   ✅ No duplicate class declarations
   ✅ Imports handled correctly
   ✅ {{input}} placeholder replaced in main code

📝 HOW TO CREATE A TEST:
   1. Student Code Template: Just the methods (no class wrapper needed)
   2. Main Template: Code that calls the solution (with {{input}})
   
   Example:
   Student Template:
       public List<String> letterCombinations(String digits) {
           // Student writes code here
       }
   
   Main Template:
       Solution sol = new Solution();
       List<String> result = sol.letterCombinations({{input}});
       System.out.println(result);

🎯 Ready to accept test sessions!
  `);
});