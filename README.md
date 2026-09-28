# Resilient Edge-Intelligence Patient Monitoring Mesh

**Project type:** Academic major project — MedTech + IoT + Computer Networking

## Overview
This project is a real-time, multi-patient monitoring prototype in which patient sensor nodes collect vital signs, perform local risk analysis, and reliably deliver prioritized health telemetry through a resilient local mesh network to an edge gateway and dashboard.

> **Note:** This is an educational/research prototype. It is not a certified medical device and does not replace clinical judgment.

## Core Features
1. **Multi-node sensing:** ESP32-based nodes with vital sensing (heart rate/SpO2, temperature).
2. **Local processing:** Filtering, signal-quality indicators, trend/risk scoring, and local critical-event detection.
3. **Resilient local networking:** Local multi-hop network with prioritized packets, acknowledgements, and retry handling.
4. **Gateway ingestion:** Gateway node forwarding normalized telemetry to the backend.
5. **Real-time dashboard:** Live patient cards, vital trends, risk state, and active alerts.
6. **Store-and-forward:** Nodes buffer data during temporary disconnections.

## Documentation
For more detailed information, please refer to the documents in the `/docs` directory:
- [PRD (Product Requirements Document)](docs/PRD.md)
- [Architecture](docs/Architecture.md)
- [Design](docs/Design.md)
- [Phases (Delivery Plan)](docs/Phases.md)
- [Rules (Engineering Rules)](docs/Rules.md)

## Current Status
- **Current Phase:** Phase 1 — Project foundation and feasibility spike
- Next steps involve confirming technology direction, creating repository foundation, and proving the hardware/protocol can produce reliable sample packets.

## Setup (WIP)
*Local development and setup instructions will be updated here as the project progresses through Phase 1.*
