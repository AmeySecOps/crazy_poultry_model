# 🐔 Automated Poultry Farming System (IoT Based)

## 📌 Overview
This project is an IoT-based smart poultry farming system using ESP8266 (NodeMCU) and Firebase. It automates temperature control, lighting, gas detection, and water management.

---

## 🚀 Features
- 🌡️ Automatic temperature control (DHT11)
- 💡 Smart lighting using LDR
- 🚨 Gas detection using MQ2 sensor
- 💧 Water level monitoring and pump automation
- 📊 Real-time data monitoring using Firebase
- 🔔 Alert system (Buzzer + LED)

---

## 🧰 Components Used
- ESP8266 NodeMCU
- DHT11 Sensor
- LDR Sensor
- MQ2 Gas Sensor
- Relay Module
- Water Level Sensor
- Water Pump
- LEDs (Red & Green)
- Buzzer

---

## 🔌 Pin Configuration

| Component | Pin |
|----------|------|
| Relay | D7 |
| DHT11 | D0 |
| LDR | D1 |
| Red LED | D2 |
| Green LED | D3 |
| Buzzer | D4 |
| MQ2 | A0 |
| Bulb | D8 |
| Water Sensor | D5 |
| Water Pump | D6 |

---

## ⚙️ Working Logic

- ✅ Normal Condition → Green LED ON  
- 🌡️ Temp > 38°C → Relay ON  
- 🌙 Darkness → Bulb ON  
- 🚨 Gas > 800 → Red LED + Buzzer + Relay ON  
- 💧 Water Low → Pump ON  

---

## 📊 Firebase Integration

Realtime data is stored in Firebase:

---

## 🖥️ Serial Monitor Output
Displays real-time sensor values for debugging.

---

## 📸 Project Images
(Add your images here)

---

## 🛠️ Future Improvements
- Mobile App (Flutter)
- Web Dashboard
- SMS/WhatsApp Alerts
- AI-based prediction system

---

## 👨‍💻 Author
Amey Jadhav

---

## ⭐ If you like this project, give it a star!
