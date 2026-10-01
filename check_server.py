import paramiko
import os

host = "130.193.57.162"
user = "kargtx"
password = "password"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    print("Connecting...")
    ssh.connect(host, username=user, password=password)
    print("Connected!")
    
    stdin, stdout, stderr = ssh.exec_command("find ~ -name bimmerlink_logger -type d 2>/dev/null")
    dirs = stdout.read().decode().strip().split('\n')
    print("Dirs:", dirs)
    
    target_dir = dirs[0] if dirs and dirs[0] else ""
    if target_dir:
        print(f"Deploying to {target_dir}")
        sftp = ssh.open_sftp()
        for f in ["server.js", "public/app.js", "public/index.html", "public/styles.css"]:
            local_path = os.path.join(os.getcwd(), f.replace('/', '\\'))
            remote_path = f"{target_dir}/{f}"
            print(f"Uploading {f}")
            sftp.put(local_path, remote_path)
            
        print("Restarting pm2...")
        stdin, stdout, stderr = ssh.exec_command("pm2 restart all")
        print(stdout.read().decode())
    else:
        print("Directory not found.")
        
except Exception as e:
    print("Error:", e)
finally:
    ssh.close()
