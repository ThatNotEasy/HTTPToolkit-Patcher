import os
import argparse
import pyfiglet
import subprocess
import sys
from colorama import init, Fore, Style

# Initialize colorama
init(autoreset=True)

def print_banner():
    banner = pyfiglet.figlet_format("HTTP Toolkit Patcher")
    print(Fore.GREEN + banner)

def check_node_installed():
    try:
        result = subprocess.run(['node', '--version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        print(Fore.GREEN + f"Node.js is installed: {result.stdout.decode().strip()}")
        return True
    except subprocess.CalledProcessError:
        print(Fore.RED + "Node.js is not installed.")
        return False

def install_node():
    print(Fore.YELLOW + "Installing Node.js...")
    os_name = sys.platform

    if os_name == 'win32':
        print(Fore.YELLOW + "Downloading Node.js installer for Windows...")
        installer_url = 'https://nodejs.org/dist/latest/node-v16.18.0-x64.msi'
        installer_path = 'nodejs_installer.msi'
        subprocess.run(['curl', '-o', installer_path, installer_url])
        subprocess.run(['msiexec', '/i', installer_path])
    elif os_name == 'darwin':
        print(Fore.YELLOW + "Downloading Node.js installer for macOS...")
        installer_url = 'https://nodejs.org/dist/latest/node-v16.18.0.pkg'
        installer_path = 'nodejs_installer.pkg'
        subprocess.run(['curl', '-o', installer_path, installer_url])
        subprocess.run(['sudo', 'installer', '-pkg', installer_path, '-target', '/'])
    elif os_name == 'linux':
        print(Fore.YELLOW + "Downloading Node.js installer for Linux...")
        subprocess.run(['curl', '-fsSL', 'https://deb.nodesource.com/setup_current.x', '|', 'sudo', 'bash', '-'])
        subprocess.run(['sudo', 'apt-get', 'install', '-y', 'nodejs'])
    else:
        print(Fore.RED + "Unsupported OS")
        sys.exit(1)

def run_npm_install():
    print(Fore.CYAN + "Running npm install...")
    result = os.system('npm install')
    if result != 0:
        print(Fore.RED + f"Error occurred while running 'npm install'. Exit code: {result}")
        return False
    return True

def run_node_patch():
    print(Fore.CYAN + "Running node . patch...")
    result = os.system('node . patch')
    if result == 0:
        print(Fore.GREEN + "Patch command executed successfully.")
    else:
        print(Fore.RED + f"Error occurred while running 'node . patch'. Exit code: {result}")

def run_node_restore():
    print(Fore.CYAN + "Running node . restore...")
    result = os.system('node . restore')
    if result == 0:
        print(Fore.GREEN + "Restore command executed successfully.")
    else:
        print(Fore.RED + f"Error occurred while running 'node . restore'. Exit code: {result}")

def run_node_start():
    print(Fore.CYAN + "Running node . start...")
    result = os.system('node . start')
    if result == 0:
        print(Fore.GREEN + "Start command executed successfully.")
    else:
        print(Fore.RED + f"Error occurred while running 'node . start'. Exit code: {result}")

def main():
    print_banner()  # Print the banner at the start
    
    if not check_node_installed():
        install_node()
    
    parser = argparse.ArgumentParser(
        description="Run various Node.js commands for HTTP Toolkit patching.")
    parser.add_argument('-p', '--patch', action='store_true', help='Run node . patch')
    parser.add_argument('-r', '--restore', action='store_true', help='Run node . restore')
    parser.add_argument('-s', '--start', action='store_true', help='Run node . start')

    args = parser.parse_args()

    # Always run npm install
    if not run_npm_install():
        return

    # Check which command to run based on arguments
    if args.patch:
        run_node_patch()
    elif args.restore:
        run_node_restore()
    elif args.start:
        run_node_start()
    else:
        print(Fore.RED + "No valid option provided. Use -p for patch, -r for restore, or -s for start.")

if __name__ == '__main__':
    os.system('clear')
    main()