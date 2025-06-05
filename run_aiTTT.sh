
#!/bin/bash

# Activate virtual environment if it exists
if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
fi

# Run the Python file
python3 aiTTT.py
