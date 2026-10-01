import paramiko
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

host = "130.193.57.162"
user = "kargtx"
password = "password"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    print("Connecting...")
    ssh.connect(host, username=user, password=password, timeout=10)
    print("Connected!")
    
    target_dir = "/home/kargtx/bimmerlink_logger"
    sftp = ssh.open_sftp()
    
    # Upload server.js
    print("Uploading server.js")
    sftp.put(os.path.join(os.getcwd(), "server.js"), f"{target_dir}/server.js")
    
    # Upload public files
    for f in ["app.js", "index.html", "styles.css"]:
        local_path = os.path.join(os.getcwd(), "public", f)
        remote_path = f"{target_dir}/public/{f}"
        print(f"Uploading {f}")
        sftp.put(local_path, remote_path)
        
    print("Restarting server...")
    stdin, stdout, stderr = ssh.exec_command("pm2 restart bimmerlink_logger")
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err:
        print("ERR:", err)
        
    print("Checking app status...")
    stdin, stdout, stderr = ssh.exec_command("curl -s http://localhost:3000/api/sessions")
    resp = stdout.read().decode()
    print("API Response start:", resp[:100])
    
except Exception as e:
    print("Error:", e)
finally:
    ssh.close()
