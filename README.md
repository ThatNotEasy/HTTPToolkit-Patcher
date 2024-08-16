# HTTP Toolkit Patcher

This project contains tools for managing and patching HTTP Toolkit installations. It includes a CLI tool (`main.py`) for patching, restoring, and starting the HTTP Toolkit application and a Flask server (`patch.py`) that serves files and handles requests.

## Overview

### `main.py`

This script provides a command-line interface (CLI) to:
- **Patch**: Apply a patch to the HTTP Toolkit application.
- **Restore**: Restore the HTTP Toolkit to its original state.
- **Start**: Start the HTTP Toolkit application.

### `patch.py`

This Flask application serves files from a temporary directory and handles requests for HTTP Toolkit resources. It supports caching and conditional fetching from the remote server.

## Prerequisites

- Python 3.6 or higher
- Node.js and npm (for patching)
- `asar` CLI tool (for extracting and packing ASAR files)

## Installation

1. Clone the repository:

    ```sh
    git clone <repository-url>
    cd <repository-directory>
    ```

2. Install the required Python packages:

    ```sh
    pip install -r requirements.txt
    ```

3. Ensure `asar` is installed. You can install it globally via npm:

    ```sh
    npm install -g asar
    ```

## Usage

### `main.py`

#### Commands

- **patch**: Applies a patch to the HTTP Toolkit application.
  
    ```sh
    python main.py patch [-p PROXY] [-P PATH]
    ```

    - `-p, --proxy`: Specify a global proxy (http/https supported).
    - `-P, --path`: Specify the path to the HTTP Toolkit folder (auto-detected by default).

- **restore**: Restores the HTTP Toolkit to its original state.

    ```sh
    python main.py restore [-P PATH]
    ```

    - `-P, --path`: Specify the path to the HTTP Toolkit folder (auto-detected by default).

- **start**: Starts the HTTP Toolkit application.

    ```sh
    python main.py start [-P PATH]
    ```

    - `-P, --path`: Specify the path to the HTTP Toolkit folder (auto-detected by default).

### `patch.py`

Run the Flask server to handle file serving and requests:

```sh
python patch.py
