import paramiko
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

host = "130.193.57.162"
user = "kargtx"
password = "password"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect(host, username=user, password=password)
    
    commands = [
        "pm2 list",
        "pm2 logs --lines 30 --nostream",
        "curl -i http://localhost:3000/api/sessions",
        "sqlite3 /home/kargtx/bimmerlink_logger/database.sqlite \".schema sessions\"",
        "sqlite3 /home/kargtx/bimmerlink_logger/database.sqlite \"SELECT id, name FROM sessions;\""
    ]
    for cmd in commands:
        print(f"=== Running: {cmd} ===")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        out = stdout.read().decode('utf-8', errors='replace')
        err = stderr.read().decode('utf-8', errors='replace')
        if out:
            print("STDOUT:\n" + out)
        if err:
            print("STDERR:\n" + err)
        print()
        
except Exception as e:
    print("Error:", e)
finally:
    ssh.close()
