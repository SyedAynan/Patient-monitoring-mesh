<div align="center">

# Resilient Edge-Intelligence Patient Monitoring Mesh
**Academic major project — MedTech + IoT + Computer Networking**

![Patient Monitoring Mesh Hero](./assets/hero_1.jpg)

*A real-time, multi-patient monitoring prototype in which patient sensor nodes collect vital signs, perform local risk analysis, and reliably deliver prioritized health telemetry through a resilient local mesh network.*

[![Phase](https://img.shields.io/badge/Phase-1%20Foundation-blue.svg)](#-current-status)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![CI](https://github.com/SyedAynan/Patient-monitoring-mesh/actions/workflows/ci.yml/badge.svg)](https://github.com/SyedAynan/Patient-monitoring-mesh/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

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
- 📜 **[Rules (Engineering Rules)](docs/Rules.md)** - Coding style, project constraints, and architectural guidelines.

## 🚀 Current Status

### Phase 1 — Project Foundation and Feasibility Spike
We are currently in the process of confirming technology directions, creating the repository foundation, and proving that the hardware/protocol can produce reliable sample packets.

## 🛠️ Setup & Development

Phase 1 currently uses only the Python standard library:

```bash
python tools/packet_demo.py
python -m unittest discover -s tests -p "test_*.py" -v
```

The physical ESP32/PlatformIO setup begins after the two-node transport spike is approved.

## 🤝 Contributing

Contributions make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please see our [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started, and our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community rules.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
