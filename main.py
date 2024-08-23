import os
import argparse

def run_npm_install():
    print("Running npm install...")
    result = os.system('npm install')
    if result != 0:
        print(f"Error occurred while running 'npm install'. Exit code: {result}")
        return False
    return True

def run_node_patch():
    print("Running node . patch...")
    result = os.system('node . patch')
    if result == 0:
        print("Patch command executed successfully.")
    else:
        print(f"Error occurred while running 'node . patch'. Exit code: {result}")

def run_node_restore():
    print("Running node . restore...")
    result = os.system('node . restore')
    if result == 0:
        print("Restore command executed successfully.")
    else:
        print(f"Error occurred while running 'node . restore'. Exit code: {result}")

def run_node_start():
    print("Running node . start...")
    result = os.system('node . start')
    if result == 0:
        print("Start command executed successfully.")
    else:
        print(f"Error occurred while running 'node . start'. Exit code: {result}")

def main():
    parser = argparse.ArgumentParser(description="Run various Node.js commands.")
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
        print("No valid option provided. Use -p for patch, -r for restore, or -s for start.")

if __name__ == '__main__':
    main()
