<div align="center">

# Resilient Edge-Intelligence Patient Monitoring Mesh
**Academic major project — MedTech + IoT + Computer Networking**

![Patient Monitoring Mesh Hero](./assets/hero_1.jpg)

*A real-time, multi-patient monitoring prototype in which patient sensor nodes collect vital signs, perform local risk analysis, and reliably deliver prioritized health telemetry through a resilient local mesh network.*

[![Phase](https://img.shields.io/badge/Progress-50%25%20(Phase%204%20Complete)-blue.svg)](#-current-status)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](.github/LICENSE)
[![CI](https://github.com/SyedAynan/Patient-monitoring-mesh/actions/workflows/ci.yml/badge.svg)](https://github.com/SyedAynan/Patient-monitoring-mesh/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](.github/CONTRIBUTING.md)

</div>

> **⚠️ Disclaimer:** This is an educational/research prototype. It is not a certified medical device and does not replace clinical judgment.

## 📑 Table of Contents
- [🌟 Core Features](#-core-features)
- [📚 Documentation](#-documentation)
- [🚀 Current Status](#-current-status)
- [🛠️ Setup & Development](#️-setup--development)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## 🌟 Core Features

- 🩺 **Multi-node sensing:** ESP32-based nodes with vital sensing (heart rate/SpO2, temperature).
- 🧠 **Local processing:** Filtering, signal-quality indicators, trend/risk scoring, and local critical-event detection.
- 🕸️ **Resilient local networking:** Local multi-hop network with prioritized packets, acknowledgements, and retry handling.
- 📡 **Gateway ingestion:** Gateway node forwarding normalized telemetry to the backend.
- 📊 **Real-time dashboard:** Live patient cards, vital trends, risk state, and active alerts.
- 💾 **Store-and-forward:** Nodes buffer data during temporary disconnections to guarantee delivery upon reconnection.

## 📚 Documentation

Detailed documentation is stored in the `/docs` directory. Read through them to understand the system design:

- 📑 **[PRD (Product Requirements Document)](docs/PRD.md)** - Project vision, user goals, and functional requirements.
- 🏗️ **[Architecture](docs/Architecture.md)** - High-level system design, edge-node architecture, and gateway details.
- 📐 **[Design](docs/Design.md)** - Component-level designs and implementation details.
- 🛤️ **[Phases (Delivery Plan)](docs/Phases.md)** - Step-by-step roadmap for project delivery.
- 📏 **[Evaluation (Measurement Method)](docs/Evaluation.md)** - Metrics, experiment scenarios, and evidence rules. No results measured yet.
- ⚠️ **[Risks (Risk Register)](docs/Risks.md)** - Hardware, protocol, security, and process risks with fallbacks.
- 📜 **[Rules (Engineering Rules)](docs/Rules.md)** - Coding style, project constraints, and architectural guidelines.

## 🚀 Current Status

### Progress: 50% Complete (Phases 1 - 4)
We have successfully completed the core foundation and edge-network logic using our comprehensive Python-based simulator:
- **Phase 1 (Foundation):** Schema, contract tests, and protocol validation established.
- **Phase 2 (Sensing & Simulator):** Multi-node sensing components (sources, processors) implemented.
- **Phase 3 (Local Transport):** Base envelope logic, gateway roles, and prioritized delivery mechanisms built.
- **Phase 4 (Resilient Routing):** Relay roles and topology models successfully introduced to test multi-hop networking.

We are currently moving towards **Phase 5 (Backend Persistence & Dashboard)** and preparing for physical node integration once hardware is available.

## 🛠️ Setup & Development

Our current stack relies heavily on the Python standard library for simulation and protocol validation. To get started and run the existing components:

```bash
# Run basic mesh and packet demonstrations
python tools/packet_demo.py
python tools/mesh_demo.py
python tools/generate_fixtures.py

# Run the test suite
python -m unittest discover -s tests -p "test_*.py" -v
```

**Simulator Architecture:**
The `simulator/` directory contains our complete testing stand-in for the physical ESP32 nodes. It implements roles (`node`, `relay`, `gateway`), topologies, and transport mechanisms (`simulated`, `espnow`) to thoroughly test deduplication, prioritizations, and routing logic before hitting actual hardware.

**Protocol Conformance:**
`shared/protocol/fixtures/` contains the language-neutral conformance corpus. Any new implementation (C++ firmware, Node backend) must accept valid fixtures byte-for-byte and reject invalid ones with matching error codes.

## 🤝 Contributing

Contributions make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please see our [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines on how to get started, and our [CODE_OF_CONDUCT.md](.github/CODE_OF_CONDUCT.md) for community rules.

## 📄 License

Distributed under the MIT License. See `.github/LICENSE` for more information.
