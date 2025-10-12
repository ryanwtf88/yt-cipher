const { spawn } = require('child_process');

console.log('Starting yt-cipher with Deno...');
console.log('Command: npx --yes deno@latest run --allow-net --allow-read --allow-write --allow-env --allow-sys server.ts');

const deno = spawn('npx', ['--yes', 'deno@latest', 'run', '--allow-net', '--allow-read', '--allow-write', '--allow-env', '--allow-sys', 'server.ts'], {
  stdio: 'inherit',
  shell: true
});

deno.on('error', (error) => {
  console.error('Failed to start Deno process:', error);
  process.exit(1);
});

deno.on('close', (code) => {
  console.log(`Deno process exited with code ${code}`);
  process.exit(code);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  deno.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  deno.kill('SIGTERM');
});
