import argparse
import os
import shutil
import subprocess
import sys
import json
from pathlib import Path
import requests
import logging
from prompt_toolkit import prompt

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()

def get_app_path(argv_path: str) -> Path:
    is_win = sys.platform == 'win32'
    is_mac = sys.platform == 'darwin'

    if argv_path:
        if argv_path.endswith('/Resources') or argv_path.endswith('/resources'):
            return Path(argv_path)
        return Path(argv_path) / ('Resources' if is_mac else 'resources')

    if is_win:
        return Path(os.getenv('LOCALAPPDATA', '')) / 'Programs' / 'httptoolkit' / 'resources'
    if is_mac:
        return Path('/Applications/HTTP Toolkit.app/Contents/Resources')
    if Path('/opt/HTTP Toolkit/resources').exists():
        return Path('/opt/HTTP Toolkit/resources')
    return Path('/opt/httptoolkit/resources')

def rm(dir_path: Path):
    if not dir_path.exists():
        return
    if not dir_path.is_dir():
        dir_path.unlink(missing_ok=True)
        return
    for entry in dir_path.iterdir():
        if entry.is_dir():
            rm(entry)
        else:
            entry.unlink(missing_ok=True)

def patch_app(app_path: Path, global_proxy: str):
    file_path = app_path / 'app.asar'
    temp_path = app_path / 'app'

    if (temp_path / 'index.js').exists():
        logger.warning('HTTP Toolkit already patched')
        return

    if global_proxy and not global_proxy.startswith(('http://', 'https://')):
        logger.error('Global proxy must start with http:// or https://')
        sys.exit(1)

    logger.info('Started patching app...')

    logger.info('Extracting app...')
    try:
        if temp_path.exists():
            rm(temp_path)
        subprocess.run(['asar', 'extract', str(file_path), str(temp_path)], check=True)
    except subprocess.CalledProcessError as e:
        logger.error('Error while extracting app', e)
        sys.exit(1)

    index_path = temp_path / 'build' / 'index.js'
    if not index_path.exists():
        logger.error('Index file not found')
        rm(temp_path)
        sys.exit(1)

    with open(index_path, 'r', encoding='utf-8') as f:
        data = f.read()

    email = prompt('Enter an email for the pro plan: ')
    if not email or '@' not in email:
        logger.error('Invalid email provided')
        rm(temp_path)
        sys.exit(1)

    patch_file = Path('patch.js')
    if not patch_file.exists():
        logger.error('Patch file not found')
        rm(temp_path)
        sys.exit(1)

    with open(patch_file, 'r', encoding='utf-8') as f:
        patch = f.read()

    patched_data = data.replace(
        'const APP_URL =',
        f'// ------- Injected by HTTP Toolkit Patcher -------\nconst email = `{email}`\nconst globalProxy = process.env.PROXY ?? `{global_proxy}`\n{patch}\n// ------- End patched content -------\nconst APP_URL ='
    )

    if data == patched_data:
        logger.error('Patch failed')
        rm(temp_path)
        sys.exit(1)

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(patched_data)

    logger.info('Patched index.js')

    logger.info('Installing dependencies...')
    try:
        proc = subprocess.Popen(['npm', 'install', 'express'], cwd=temp_path, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        proc.communicate()
        if proc.returncode != 0:
            logger.error('Error while installing dependencies')
            rm(temp_path)
            sys.exit(1)
    except Exception as e:
        logger.error('Error while installing dependencies', e)
        rm(temp_path)
        sys.exit(1)

    rm(temp_path / 'package-lock.json')
    shutil.copy(file_path, f'{file_path}.bak')
    logger.info(f'Backup created at {file_path}.bak')

    logger.info('Building app...')
    try:
        subprocess.run(['asar', 'pack', str(temp_path), str(file_path)], check=True)
    except subprocess.CalledProcessError as e:
        logger.error('Error while building app', e)
        rm(temp_path)
        sys.exit(1)

    rm(temp_path)
    logger.info('HTTP Toolkit patched successfully')

def restore_app(app_path: Path):
    backup_path = app_path / 'app.asar.bak'
    if not backup_path.exists():
        logger.error('HTTP Toolkit not patched or backup file not found')
        sys.exit(1)
    
    shutil.copy(backup_path, app_path / 'app.asar')
    logger.info('HTTP Toolkit restored')

def start_app(app_path: Path):
    is_win = sys.platform == 'win32'
    is_mac = sys.platform == 'darwin'

    logger.info('Starting HTTP Toolkit...')
    try:
        command = (
            f'"{str(app_path.parent / "HTTP Toolkit.exe")}"' if is_win
            else 'open -a "HTTP Toolkit"' if is_mac
            else 'httptoolkit'
        )
        proc = subprocess.Popen(command, shell=True)
        proc.communicate()
    except Exception as e:
        logger.error('Error while starting HTTP Toolkit', e)
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description='Manage HTTP Toolkit patches')
    parser.add_argument('command', choices=['patch', 'restore', 'start'], help='Command to execute')
    parser.add_argument('-p', '--proxy', type=str, help='Specify a global proxy (only http/https supported)')
    parser.add_argument('-P', '--path', type=str, help='Specify the path to the HTTP Toolkit folder (auto-detected by default)')

    args = parser.parse_args()

    app_path = get_app_path(args.path)

    if not (app_path / 'app.asar').exists():
        logger.error('HTTP Toolkit not found. Try specifying the path with --path')
        sys.exit(1)

    if args.command == 'patch':
        patch_app(app_path, args.proxy)
    elif args.command == 'restore':
        restore_app(app_path)
    elif args.command == 'start':
        start_app(app_path)

if __name__ == '__main__':
    main()
