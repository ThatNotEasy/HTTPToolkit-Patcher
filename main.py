import os

def run_commands():
    install_command = 'npm install'
    patch_command = 'node . patch'
    print("Running npm install...")
    result_install = os.system(install_command)
    if result_install != 0:
        print(f"Error occurred while running 'npm install'. Exit code: {result_install}")
        return

    print("Running node . patch...")
    result_patch = os.system(patch_command)
    if result_patch == 0:
        print("Command executed successfully.")
    else:
        print(f"Error occurred while running 'node . patch'. Exit code: {result_patch}")

if __name__ == '__main__':
    run_commands()