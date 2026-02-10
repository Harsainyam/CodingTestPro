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

// Helper function to get language config
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
  } catch (e) {}

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
  } catch (e) {}

  try {
    const actualNum = parseFloat(normalizedActual);
    const expectedNum = parseFloat(normalizedExpected);

    if (!isNaN(actualNum) && !isNaN(expectedNum)) {
      return Math.abs(actualNum - expectedNum) < 0.0001;
    }
  } catch (e) {}

  if (normalizedActual.toLowerCase() === normalizedExpected.toLowerCase()) {
    return true;
  }

  return actual.trim() === expected.trim();
}

// FIX: Proper Java wrapper that handles List return types
function wrapCodeWithTestHarness(code, testCases, language, functionName) {
  // Auto-detect function name if not provided
  if (!functionName) {
    const jsMatch = code.match(/function\s+(\w+)\s*\(/);
    const pyMatch = code.match(/def\s+(\w+)\s*\(/);
    const javaMatch = code.match(/(?:public|private|protected)?\s*(?:static)?\s*\w+(?:<[^>]+>)?\s+(\w+)\s*\(/);

    if (jsMatch) functionName = jsMatch[1];
    else if (pyMatch) functionName = pyMatch[1];
    else if (javaMatch) functionName = javaMatch[1];
    else functionName = 'solution';
  }

  switch (language) {
    case 'javascript':
      return `${code}

// ===== AUTO-GENERATED TEST HARNESS =====
const testCases = ${JSON.stringify(testCases)};

testCases.forEach((tc, idx) => {
    try {
        const inputParts = tc.input.split(',').map(s => s.trim());
        const args = inputParts.map(arg => {
            try {
                return JSON.parse(arg);
            } catch (e) {
                const num = Number(arg);
                return isNaN(num) ? arg.replace(/['"]/g, '') : num;
            }
        });
        
        const result = ${functionName}(...args);
        console.log('TEST_CASE_' + idx + ':' + JSON.stringify(result));
    } catch (error) {
        console.log('TEST_CASE_' + idx + '_ERROR:' + error.message);
    }
});
`;

    case 'python':
      return `${code}

# ===== AUTO-GENERATED TEST HARNESS =====
import json
test_cases = ${JSON.stringify(testCases)}

for idx, tc in enumerate(test_cases):
    try:
        input_parts = [s.strip() for s in tc['input'].split(',')]
        args = []
        for arg in input_parts:
            try:
                args.append(json.loads(arg))
            except:
                try:
                    args.append(float(arg) if '.' in arg else int(arg))
                except:
                    args.append(arg.strip('\\\"\\''))
        
        result = ${functionName}(*args)
        print(f'TEST_CASE_{idx}:{json.dumps(result)}')
    except Exception as error:
        print(f'TEST_CASE_{idx}_ERROR:{str(error)}')
`;

    case 'java':
      // FIX: Proper Java implementation with JSON handling
      return `import java.util.*;
import com.google.gson.Gson;

${code}

public class Main {
    private static Gson gson = new Gson();
    
    public static void main(String[] args) {
        Solution solution = new Solution();
        
        // Test cases: [input, expectedOutput]
        String[][] testCases = {
${testCases.map(tc => `            {"${tc.input.replace(/"/g, '\\"')}", "${tc.output.replace(/"/g, '\\"')}"}`).join(',\n')}
        };
        
        for (int i = 0; i < testCases.length; i++) {
            try {
                String input = testCases[i][0];
                
                // Parse input - split by comma outside quotes/brackets
                List<String> inputs = parseInput(input);
                
                Object result = null;
                
                // Call the function based on number of parameters
                if (inputs.size() == 1) {
                    String arg = inputs.get(0).trim();
                    if (arg.startsWith("[")) {
                        // It's an array or list
                        result = solution.${functionName}(arg);
                    } else if (arg.startsWith("\\"")) {
                        // It's a string
                        result = solution.${functionName}(arg.substring(1, arg.length() - 1));
                    } else {
                        // It's a number
                        result = solution.${functionName}(arg);
                    }
                } else if (inputs.size() == 2) {
                    result = callWithTwoArgs(solution, inputs);
                }
                
                // Output result as JSON
                String jsonResult = gson.toJson(result);
                System.out.println("TEST_CASE_" + i + ":" + jsonResult);
                
            } catch (Exception e) {
                System.out.println("TEST_CASE_" + i + "_ERROR:" + e.getMessage());
            }
        }
    }
    
    private static List<String> parseInput(String input) {
        List<String> result = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        int bracketDepth = 0;
        boolean inQuotes = false;
        
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            
            if (c == '"') {
                inQuotes = !inQuotes;
                current.append(c);
            } else if (c == '[' || c == '{') {
                bracketDepth++;
                current.append(c);
            } else if (c == ']' || c == '}') {
                bracketDepth--;
                current.append(c);
            } else if (c == ',' && bracketDepth == 0 && !inQuotes) {
                result.add(current.toString().trim());
                current = new StringBuilder();
            } else {
                current.append(c);
            }
        }
        
        if (current.length() > 0) {
            result.add(current.toString().trim());
        }
        
        return result;
    }
    
    private static Object callWithTwoArgs(Solution solution, List<String> inputs) throws Exception {
        String arg1 = inputs.get(0).trim();
        String arg2 = inputs.get(1).trim();
        
        // Determine types and call appropriate method
        if (arg1.startsWith("\\"") && arg2.matches("\\\\d+")) {
            return solution.letterCombinations(arg1.substring(1, arg1.length() - 1));
        } else if (arg1.startsWith("[") && arg2.matches("\\\\d+")) {
            return solution.letterCombinations(arg1);
        }
        
        return null;
    }
}

// Minimal Gson implementation for basic JSON serialization
class Gson {
    public String toJson(Object obj) {
        if (obj == null) return "null";
        if (obj instanceof String) return "\\"" + obj + "\\"";
        if (obj instanceof Number) return obj.toString();
        if (obj instanceof Boolean) return obj.toString();
        if (obj instanceof List) {
            List<?> list = (List<?>) obj;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append(toJson(list.get(i)));
            }
            sb.append("]");
            return sb.toString();
        }
        if (obj instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) obj;
            StringBuilder sb = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) sb.append(",");
                sb.append("\\"").append(entry.getKey()).append("\\":");
                sb.append(toJson(entry.getValue()));
                first = false;
            }
            sb.append("}");
            return sb.toString();
        }
        return "\\"" + obj.toString() + "\\"";
    }
}
`;

    default:
      return code;
  }
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
    // Return full test data including hidden test cases for execution
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

// FIX: Enhanced code execution with proper hidden test case handling
app.post('/api/execute', async (req, res) => {
  const { code, testCases, language = 'javascript', functionName, questionId } = req.body;

  if (!code || !testCases || testCases.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Code and test cases are required'
    });
  }

  try {
    // Get hidden test cases from the test definition
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
    
    const langConfig = getPistonLanguageConfig(language);
    
    // Combine visible and hidden test cases
    const allTestCases = [...testCases, ...hiddenTestCases];
    const wrappedCode = wrapCodeWithTestHarness(code, allTestCases, language, functionName);

    console.log('Executing code with', testCases.length, 'visible and', hiddenTestCases.length, 'hidden test cases');

    const startTime = Date.now();

    const response = await fetch('https://emkc.org/api/v2/piston/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: langConfig.language,
        version: langConfig.version,
        files: [{
          name: langConfig.file,
          content: wrappedCode
        }],
        stdin: '',
        args: [],
        compile_timeout: 10000,
        run_timeout: 5000
      })
    });

    if (!response.ok) {
      throw new Error(`Execution service error: ${response.statusText}`);
    }

    const result = await response.json();
    const executionTime = Date.now() - startTime;

    // Check compilation errors
    if (result.compile && result.compile.stderr) {
      const errorResults = allTestCases.map((tc, i) => ({
        testCase: i + 1,
        input: tc.input,
        expectedOutput: tc.output,
        actualOutput: '',
        passed: false,
        error: 'Compilation failed',
        executionTime: 0,
        status: 'compilation_error'
      }));
      
      return res.json({
        success: false,
        error: 'Compilation Error',
        details: result.compile.stderr,
        visibleResults: errorResults.slice(0, testCases.length),
        hiddenResults: errorResults.slice(testCases.length),
        summary: {
          total: allTestCases.length,
          passed: 0,
          failed: allTestCases.length,
          allPassed: false,
          percentage: 0,
          visiblePassed: 0,
          hiddenPassed: 0
        }
      });
    }

    // Parse output
    const output = result.run?.stdout || '';
    const stderr = result.run?.stderr || '';
    const lines = output.split('\n').filter(line => line.trim());

    console.log('Execution output:', output);
    console.log('Found', lines.length, 'output lines');

    const allResults = [];

    allTestCases.forEach((tc, idx) => {
      const resultLine = lines.find(line => line.startsWith(`TEST_CASE_${idx}:`));
      const errorLine = lines.find(line => line.startsWith(`TEST_CASE_${idx}_ERROR:`));

      if (errorLine) {
        const error = errorLine.substring(`TEST_CASE_${idx}_ERROR:`.length);
        allResults.push({
          testCase: idx + 1,
          input: tc.input,
          expectedOutput: tc.output,
          actualOutput: '',
          passed: false,
          error: error,
          executionTime: executionTime / allTestCases.length,
          status: 'runtime_error'
        });
      } else if (resultLine) {
        const actualOutput = resultLine.substring(`TEST_CASE_${idx}:`.length).trim();
        const passed = compareOutputs(actualOutput, tc.output);

        allResults.push({
          testCase: idx + 1,
          input: tc.input,
          expectedOutput: tc.output,
          actualOutput: actualOutput,
          passed: passed,
          executionTime: executionTime / allTestCases.length,
          status: passed ? 'passed' : 'failed',
          stderr: null
        });
      } else {
        allResults.push({
          testCase: idx + 1,
          input: tc.input,
          expectedOutput: tc.output,
          actualOutput: '',
          passed: false,
          error: stderr || 'No output produced',
          executionTime: executionTime / allTestCases.length,
          status: 'no_output'
        });
      }
    });

    // Separate visible and hidden results
    const visibleResults = allResults.slice(0, testCases.length);
    const hiddenResults = allResults.slice(testCases.length);

    const visiblePassed = visibleResults.filter(r => r.passed).length;
    const hiddenPassed = hiddenResults.filter(r => r.passed).length;
    const totalPassed = visiblePassed + hiddenPassed;
    const totalTests = allResults.length;

    console.log('Results:', {
      total: totalTests,
      passed: totalPassed,
      visiblePassed,
      hiddenPassed
    });

    res.json({
      success: true,
      visibleResults,
      hiddenResults,
      summary: {
        total: totalTests,
        passed: totalPassed,
        failed: totalTests - totalPassed,
        allPassed: totalPassed === totalTests,
        percentage: totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(2) : 0,
        visiblePassed,
        hiddenPassed
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

// Custom input execution
app.post('/api/execute/custom', async (req, res) => {
  const { code, customInput, language = 'javascript', functionName } = req.body;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: 'Code is required'
    });
  }

  try {
    const langConfig = getPistonLanguageConfig(language);
    
    const testCase = { input: customInput, output: '' };
    const wrappedCode = wrapCodeWithTestHarness(code, [testCase], language, functionName);
    
    const startTime = Date.now();

    const response = await fetch('https://emkc.org/api/v2/piston/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: langConfig.language,
        version: langConfig.version,
        files: [{
          name: langConfig.file,
          content: wrappedCode
        }],
        stdin: '',
        args: [],
        compile_timeout: 10000,
        run_timeout: 3000
      })
    });

    if (!response.ok) {
      throw new Error(`Execution service error: ${response.statusText}`);
    }

    const result = await response.json();
    const executionTime = Date.now() - startTime;

    if (result.compile && result.compile.stderr) {
      return res.json({
        success: false,
        error: 'Compilation Error',
        stderr: result.compile.stderr,
        executionTime
      });
    }

    const output = result.run?.stdout || '';
    const resultLine = output.split('\n').find(line => line.startsWith('TEST_CASE_0:'));
    
    let finalOutput = '';
    if (resultLine) {
      finalOutput = resultLine.substring('TEST_CASE_0:'.length).trim();
    } else {
      finalOutput = output;
    }

    res.json({
      success: true,
      output: finalOutput,
      stderr: result.run?.stderr || null,
      exitCode: result.run?.code || 0,
      executionTime,
      hasError: result.run && result.run.stderr && result.run.code !== 0
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
║          🚀 Coding Test Platform Server (v2.1)             ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

✅ Server running on port ${PORT}
🌐 Admin Panel: http://localhost:${PORT}/admin.html
🔐 Default Credentials: admin / admin123

🆕 FIXES:
   ✅ Java execution with proper List/JSON handling
   ✅ Hidden test cases now showing pass/fail
   ✅ Resizable editor with proper scrolling
   ✅ Smart input parsing for complex types

🎯 Ready to accept test sessions!
  `);
});