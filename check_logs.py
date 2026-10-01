import paramiko

host = "130.193.57.162"
user = "kargtx"
password = "password"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    ssh.connect(host, username=user, password=password)
    
    stdin, stdout, stderr = ssh.exec_command("ls -la /home/kargtx/bimmerlink_logger/public")
    print("Public Files:")
    print(stdout.read().decode())
    
except Exception as e:
    print("Error:", e)
finally:
    ssh.close()
