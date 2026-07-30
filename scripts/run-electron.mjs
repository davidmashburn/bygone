import { spawn } from 'child_process';
import electronPath from 'electron';

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, process.argv.slice(2), {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit'
});

child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exitCode = code ?? 0;
});
