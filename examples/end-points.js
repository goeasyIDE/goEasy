// Discover all the ws api you can use in your extensions.
const WebSocket = require('ws');
const { spawn, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

module.exports = function(server, password) {
  const wss = new WebSocket.Server({ server });
  const EXT_DIR = path.join(process.cwd(), 'extensions');
  const runningProcesses = {};

  if (!fs.existsSync(EXT_DIR)) fs.mkdirSync(EXT_DIR);

  function getFiles(dir, base = '') {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const fullPath = path.join(dir, file);
      const relativePath = path.join(base, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(relativePath + '/');
        results = results.concat(getFiles(fullPath, relativePath));
      } else {
        results.push(relativePath);
      }
    });
    return results;
  }

  function resolveRunner(filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const interpreters = {
      js:     { cmd: 'node', args: [filePath] },
      mjs:    { cmd: 'node', args: [filePath] },
      cjs:    { cmd: 'node', args: [filePath] },
      ts:     { cmd: 'npx', args: ['--yes', 'ts-node', '--transpile-only', filePath] },
      py:     { cmd: 'python', args: [filePath] },
      rb:     { cmd: 'ruby', args: [filePath] },
      php:    { cmd: 'php', args: [filePath] },
      sh:     { cmd: 'bash', args: [filePath] },
      bash:   { cmd: 'bash', args: [filePath] },
      zsh:    { cmd: 'zsh', args: [filePath] },
      fish:   { cmd: 'fish', args: [filePath] },
      go:     { cmd: 'go', args: ['run', filePath] },
      lua:    { cmd: 'lua', args: [filePath] },
      r:      { cmd: 'Rscript', args: [filePath] },
      pl:     { cmd: 'perl', args: [filePath] },
      swift:  { cmd: 'swift', args: [filePath] },
      dart:   { cmd: 'dart', args: ['run', filePath] },
      coffee: { cmd: 'coffee', args: [filePath] },
      nim:    { cmd: 'nim', args: ['r', filePath] },
      zig:    { cmd: 'zig', args: ['run', filePath] },
      ex:     { cmd: 'elixir', args: [filePath] },
      exs:    { cmd: 'elixir', args: [filePath] },
      cr:     { cmd: 'crystal', args: ['run', filePath] },
      jl:     { cmd: 'julia', args: [filePath] },
    };

    if (interpreters[ext]) return { type: 'interpret', ...interpreters[ext] };

    const tmpDir = os.tmpdir();
    const base = path.basename(filePath, path.extname(filePath));
    const outBin = path.join(tmpDir, base + '_' + Date.now());

    const compiled = {
      c:    { compile: ['gcc', [filePath, '-o', outBin, '-lm']], run: [outBin, []] },
      cpp:  { compile: ['g++', [filePath, '-o', outBin, '-std=c++17', '-lm']], run: [outBin, []] },
      cc:   { compile: ['g++', [filePath, '-o', outBin, '-std=c++17', '-lm']], run: [outBin, []] },
      rs:   { compile: ['rustc', [filePath, '-o', outBin]], run: [outBin, []] },
      kt: {
        compile: ['kotlinc', [filePath, '-include-runtime', '-d', outBin + '.jar']],
        run: ['java', ['-jar', outBin + '.jar']],
      },
      cs: { compile: null, run: ['dotnet', ['script', filePath]] },
      java: {
        compile: ['javac', [filePath]],
        run: ['java', ['-cp', path.dirname(filePath), base]],
      },
    };

    if (compiled[ext]) return { type: 'compile', ext, outBin, ...compiled[ext] };
    return null;
  }

  wss.on('connection', (ws) => {
    const platform = os.platform();
    let shell;

    if (platform === 'win32') {
      shell = spawn('powershell.exe', [], { cwd: process.cwd(), env: process.env, shell: false });
    } else {
      shell = spawn('script', ['-q', '-c', 'bash', '/dev/null'], { cwd: process.cwd(), env: process.env, shell: false });
    }

    ws.on('message', async (msg) => {
      let data;
      try { data = JSON.parse(msg); }
      catch { return ws.send(JSON.stringify({ type: 'error', data: 'Invalid JSON' })); }

      if (data.password !== password)
        return ws.send(JSON.stringify({ type: 'error', data: 'Invalid password' }));

      try {
        if (data.type === 'command') {
          shell.stdin.write(data.command + '\n');
        }

        if (data.type === 'list-files') {
          const files = getFiles(process.cwd());
          ws.send(JSON.stringify({ type: 'files-list', files }));
        }

        if (data.type === 'load-file') {
          const filePath = path.join(process.cwd(), data.name);
          if (!fs.existsSync(filePath))
            return ws.send(JSON.stringify({ type: 'error', data: 'File not found' }));
          const content = fs.readFileSync(filePath, 'utf-8');
          ws.send(JSON.stringify({ type: 'file-content', content }));
        }

        if (data.type === 'create-file') {
          const filePath = path.join(process.cwd(), data.name);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, data.content || '');
          ws.send(JSON.stringify({ type: 'file-created' }));
        }

        if (data.type === 'delete-file') {
          const filePath = path.join(process.cwd(), data.name);
          if (!fs.existsSync(filePath))
            return ws.send(JSON.stringify({ type: 'error', data: 'File not found' }));
          fs.unlinkSync(filePath);
          ws.send(JSON.stringify({ type: 'file-deleted' }));
        }

        if (data.type === 'create-folder') {
          const folderPath = path.join(process.cwd(), data.name);
          fs.mkdirSync(folderPath, { recursive: true });
          ws.send(JSON.stringify({ type: 'folder-created' }));
        }

        if (data.type === 'rename-file') {
          const oldPath = path.join(process.cwd(), data.oldPath);
          const newPath = path.join(process.cwd(), data.newPath);
          if (!fs.existsSync(oldPath))
            return ws.send(JSON.stringify({ type: 'error', data: 'File not found' }));
          fs.renameSync(oldPath, newPath);
          ws.send(JSON.stringify({ type: 'file-renamed' }));
        }

        if (data.type === 'process') {
          if (platform === 'win32') {
            const ps = spawn('wmic', ['process', 'get', 'ProcessId,ParentProcessId,CommandLine,WorkingSetSize']);
            let output = '';
            ps.stdout.on('data', d => output += d.toString());
            ps.on('close', () => {
              const lines = output.split('\n').slice(1).filter(l => l.trim());
              const processes = lines.map(line => {
                const parts = line.trim().split(/\s+/);
                return { pid: parts[parts.length-1], ppid: parts[parts.length-2], mem: parts[parts.length-3], cmd: parts.slice(0,parts.length-3).join(' ') };
              });
              ws.send(JSON.stringify({ type: 'process-list', processes }));
            });
          } else {
            const ps = spawn('ps', ['-eo', 'pid,ppid,%cpu,%mem,cmd']);
            let output = '';
            ps.stdout.on('data', d => output += d.toString());
            ps.on('close', () => {
              const lines = output.split('\n').slice(1).filter(l => l.trim());
              const processes = lines.map(line => {
                const parts = line.trim().split(/\s+/);
                return { pid: parts[0], ppid: parts[1], cpu: parts[2], mem: parts[3], cmd: parts.slice(4).join(' ') };
              });
              ws.send(JSON.stringify({ type: 'process-list', processes }));
            });
          }
        }

        if (data.type === 'end-process') {
          const { pid } = data;
          if (!pid) return ws.send(JSON.stringify({ type: 'error', data: 'PID required' }));
          try {
            platform === 'win32' ? spawn('taskkill', ['/PID', pid, '/F', '/T']) : process.kill(pid, 'SIGKILL');
            ws.send(JSON.stringify({ type: 'process-killed', pid }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', data: err.message }));
          }
        }

        if (data.type === 'run') {
          const { file, args = [], debug = false } = data;
          const filePath = path.join(process.cwd(), file);

          if (!fs.existsSync(filePath))
            return ws.send(JSON.stringify({ type: 'error', data: 'File not found' }));

          const runner = resolveRunner(filePath);
          if (!runner)
            return ws.send(JSON.stringify({ type: 'error', data: `Unsupported file type: ${path.extname(filePath)}` }));

          const runId = Date.now();
          ws.send(JSON.stringify({ type: 'run-started', runId, debug }));

          const spawnRun = (cmd, cmdArgs) => {
            const proc = spawn(cmd, [...cmdArgs, ...args], { cwd: process.cwd(), shell: true });
            runningProcesses[runId] = proc;

            proc.stdout.on('data', d => ws.send(JSON.stringify({ type: 'run-stdout', runId, data: d.toString() })));

            proc.stderr.on('data', d => {
              const text = d.toString();
              const match = text.match(/\((.*):(\d+):(\d+)\)/);

              if (match) {
                ws.send(JSON.stringify({
                  type: 'run-error',
                  runId,
                  file: match[1],
                  line: Number(match[2]),
                  column: Number(match[3]),
                  message: text
                }));
              } else {
                ws.send(JSON.stringify({ type: 'run-stderr', runId, data: text, debug }));
              }
            });

            proc.on('close', code => {
              ws.send(JSON.stringify({ type: 'run-exit', runId, code }));
              delete runningProcesses[runId];
              try {
                if (runner.outBin && fs.existsSync(runner.outBin)) fs.unlinkSync(runner.outBin);
                if (runner.ext === 'kt' && fs.existsSync(runner.outBin + '.jar')) fs.unlinkSync(runner.outBin + '.jar');
              } catch {}
            });
          };

          if (runner.type === 'interpret') {
            spawnRun(runner.cmd, runner.args);
          } else if (runner.type === 'compile') {
            if (runner.compile === null) {
              spawnRun(runner.run[0], runner.run[1]);
            } else {
              ws.send(JSON.stringify({ type: 'run-stderr', runId, data: `Compiling ${path.basename(filePath)}...\n` }));
              const compiler = spawn(runner.compile[0], runner.compile[1], { cwd: process.cwd() });
              compiler.stdout.on('data', d => ws.send(JSON.stringify({ type: 'run-stderr', runId, data: d.toString(), debug })));
              compiler.stderr.on('data', d => ws.send(JSON.stringify({ type: 'run-stderr', runId, data: d.toString(), debug })));
              compiler.on('close', code => {
                if (code !== 0) {
                  ws.send(JSON.stringify({ type: 'run-exit', runId, code }));
                  delete runningProcesses[runId];
                } else {
                  ws.send(JSON.stringify({ type: 'run-stderr', runId, data: 'Compiled OK. Running...\n' }));
                  spawnRun(runner.run[0], runner.run[1]);
                }
              });
            }
          }
        }

        if (data.type === 'run-stop') {
          const { runId } = data;
          const proc = runningProcesses[runId];
          if (!proc) return ws.send(JSON.stringify({ type: 'error', data: 'No such running process' }));
          try {
            proc.kill('SIGKILL');
            ws.send(JSON.stringify({ type: 'run-stopped', runId }));
            delete runningProcesses[runId];
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', data: err.message }));
          }
        }

        if (data.type === 'run-input') {
          const { runId, input } = data;
          const proc = runningProcesses[runId];
          if (!proc) return ws.send(JSON.stringify({ type: 'error', data: 'No such running process' }));
          proc.stdin.write(input + '\n');
        }

        if (data.type === 'extension-install') {
          const { id } = data;
          const res = await fetch('https://goeasyide.github.io/goEasy/extensions.json');
          const extensions = await res.json();
          const ext = extensions.find(e => e.id === id);
          if (!ext) return ws.send(JSON.stringify({ type: 'error', data: 'Extension not found' }));
          if (ext.type === 'terminal' && Array.isArray(ext.install)) {
            for (const cmd of ext.install) shell.stdin.write(cmd + '\n');
          }
          const extFile = path.join(EXT_DIR, `${ext.id}.json`);
          fs.writeFileSync(extFile, JSON.stringify(ext, null, 2));
          ws.send(JSON.stringify({ type: 'extension-installed', id: ext.id }));
        }

        if (data.type === 'extension-uninstall') {
          const { id } = data;
          const extFile = path.join(EXT_DIR, `${id}.json`);
          if (!fs.existsSync(extFile)) return ws.send(JSON.stringify({ type: 'error', data: 'Extension not found' }));
          const ext = JSON.parse(fs.readFileSync(extFile, 'utf-8'));
          if (ext.type === 'terminal' && Array.isArray(ext.uninstall)) {
            for (const cmd of ext.uninstall) shell.stdin.write(cmd + '\n');
          }
          fs.unlinkSync(extFile);
          ws.send(JSON.stringify({ type: 'extension-uninstalled', id }));
        }

        if (data.type === 'extension-load') {
          const files = fs.readdirSync(EXT_DIR);
          const allExts = [];
          for (const f of files) {
            try { allExts.push(JSON.parse(fs.readFileSync(path.join(EXT_DIR, f), 'utf-8'))); } catch {}
          }
          ws.send(JSON.stringify({ type: 'extension-loaded', extensions: allExts }));
        }

      } catch (err) {
        console.error(err);
        ws.send(JSON.stringify({ type: 'error', data: 'Internal error: ' + err.message }));
      }
    });

    shell.stdout.on('data', (data) => ws.send(JSON.stringify({ type: 'stdout', data: data.toString() })));
    shell.stderr.on('data', (data) => ws.send(JSON.stringify({ type: 'stderr', data: data.toString() })));
    shell.on('close', () => ws.send(JSON.stringify({ type: 'exit' })));

    ws.on('close', () => {
      shell.kill();
      Object.values(runningProcesses).forEach(p => p.kill('SIGKILL'));
    });
  });
};
