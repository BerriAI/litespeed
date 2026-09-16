"""Run selected acceptance tests without repository conftest, credentials or network."""
import os
from pathlib import Path
import socket
import sys
import importlib.util
import tempfile

workspace=Path(sys.argv[1]).resolve()
arguments=sys.argv[2:]
if not (workspace/'litellm/__init__.py').is_file():
    raise ValueError('Evaluation requires a complete LiteLLM snapshot, not only reference tests.')
os.environ.clear()
os.environ.update({'PATH':'/usr/bin:/bin','LITELLM_LOCAL_MODEL_COST_MAP':'True','PYTHON_DOTENV_DISABLED':'1','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1','DO_NOT_TRACK':'1'})
os.chdir(workspace)
sys.path.insert(0,str(workspace))
spec=importlib.util.find_spec('litellm')
if spec is None or Path(spec.origin).resolve()!=(workspace/'litellm/__init__.py').resolve():
    raise ValueError('LiteLLM import does not resolve to the selected snapshot.')
# Qualification and supplemental probes must not contaminate reusable bases,
# and inherited bytecode must not bypass the candidate's current source.
bytecode=tempfile.TemporaryDirectory(prefix='litellm-eval-cache-')
sys.pycache_prefix=bytecode.name
sys.dont_write_bytecode=True
def blocked(*args,**kwargs):
    raise RuntimeError('Outbound network is disabled in the offline evaluation.')
socket.socket.connect=blocked
socket.socket.connect_ex=blocked
socket.create_connection=blocked
socket.getaddrinfo=blocked
import pytest
status=pytest.main(['-c','/dev/null','--noconftest','-p','no:cacheprovider','-p','pytest_asyncio.plugin','-p','pytest_mock','-p','respx.plugin','-q','--tb=short',*arguments])
for name,module in list(sys.modules.items()):
    if (name=='litellm' or name.startswith('litellm.')) and getattr(module,'__file__',None):
        Path(module.__file__).resolve().relative_to(workspace)
bytecode.cleanup()
sys.exit(status)
