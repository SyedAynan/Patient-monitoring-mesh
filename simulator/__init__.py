"""Phase 1 and Phase 2 simulator for the patient monitoring mesh.

Subpackages:

- `simulator.transport` — the transport abstraction and its simulated link.
- `simulator.sensing` — synthetic vital sources, conversion, filtering, node logic.

`simulator/feasibility_spike.py` is a standalone Phase 1 script and is kept
separate on purpose; it is run directly rather than imported.
"""