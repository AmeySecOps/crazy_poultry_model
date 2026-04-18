#include <ESP8266WiFi.h>
#include <Firebase_ESP_Client.h>
#include <DHT.h>

// ---------------- WIFI ----------------
#define WIFI_SSID "Int"
#define WIFI_PASSWORD "00000002"

// ---------------- FIREBASE ----------------
// ⚠️ REPLACE WITH YOUR ACTUAL VALUES
#define API_KEY "AIzaSyBfJQvOf2PZlcyBoBjF6D20jzgDrqBigjA"
#define DATABASE_URL "automated-poultry-farming-stm-default-rtdb.asia-southeast1.firebasedatabase.app"

// Firebase Objects
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// ---------------- DHT ----------------
#define DHTPIN D4
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

// ---------------- PIN SETUP ----------------
#define RELAY D7      // Cooling fan/heater relay
#define LDR D1        // Light sensor
#define RED_LED D2    // Alarm LED
#define GREEN_LED D3  // Normal operation LED
#define BUZZER D0     // Alarm buzzer
#define MQ2 A0        // Gas sensor
#define BULB D8       // Lighting bulb
#define WATER_SENSOR D5
#define WATER_PUMP D6

// ---------------- VARIABLES ----------------
float temp;
int ldrValue;
int gasValue;
int waterValue;
bool wifiConnected = false;
bool firebaseConnected = false;
unsigned long lastSensorRead = 0;
const unsigned long SENSOR_INTERVAL = 2000;

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== POULTRY MONITORING SYSTEM ===");

  // Pin initialization
  pinMode(RELAY, OUTPUT);
  pinMode(LDR, INPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(GREEN_LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  pinMode(BULB, OUTPUT);
  pinMode(WATER_SENSOR, INPUT);
  pinMode(WATER_PUMP, OUTPUT);

  // Set initial states
  digitalWrite(RELAY, LOW);
  digitalWrite(RED_LED, LOW);
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(BUZZER, LOW);
  digitalWrite(BULB, LOW);
  digitalWrite(WATER_PUMP, LOW);

  dht.begin();

  // WiFi connection with timeout
  connectToWiFi();

  // Firebase connection
  connectToFirebase();

  Serial.println("System initialized successfully!");
  digitalWrite(GREEN_LED, HIGH);  // Show system ready
}

void loop() {
  // Check connections periodically
  static unsigned long lastConnectionCheck = 0;
  if (millis() - lastConnectionCheck > 30000) {  // Every 30 seconds
    checkConnections();
    lastConnectionCheck = millis();
  }

  // Read sensors at regular intervals
  if (millis() - lastSensorRead >= SENSOR_INTERVAL) {
    readSensors();
    controlSystem();
    updateFirebase();
    printStatus();
    lastSensorRead = millis();
  }
}

void connectToWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("\n✅ WiFi Connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    wifiConnected = false;
    Serial.println("\n❌ WiFi Connection Failed!");
  }
}

void connectToFirebase() {
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  config.token_status_callback = tokenStatusCallback;

  config.signer.test_mode = true;
  config.timeout.serverResponse = 2000;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // Wait for Firebase to connect
  Serial.print("Connecting to Firebase");
  int attempts = 0;
  while (!Firebase.ready() && attempts < 10) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (Firebase.ready()) {
    firebaseConnected = true;
    Serial.println("\n✅ Firebase Connected!");
  } else {
    firebaseConnected = false;
    Serial.println("\n❌ Firebase Connection Failed!");
  }
}

void tokenStatusCallback(TokenInfo info) {
  if (info.status == token_status_error) {
    Serial.println("Token error. Reconnecting...");
    firebaseConnected = false;
  }
}

void readSensors() {
  // Read temperature with validation
  float newTemp = dht.readTemperature();
  if (!isnan(newTemp)) {
    temp = newTemp;
  } else {
    Serial.println("Failed to read temperature!");
    temp = -1;  // Error indicator
  }

  ldrValue = digitalRead(LDR);
  gasValue = analogRead(MQ2);
  waterValue = digitalRead(WATER_SENSOR);
}

void controlSystem() {
  bool alarmActive = false;

  // -------- TEMPERATURE CONTROL --------
  if (temp > 38 && temp != -1) {
    digitalWrite(RELAY, LOW);  // Turn ON cooling
  } else {
    digitalWrite(RELAY, HIGH);  // Turn OFF
  }

  // -------- LDR CONTROL (Light automation) --------
  if (ldrValue == HIGH) {  // Dark
    digitalWrite(BULB, HIGH);
  } else {
    digitalWrite(BULB, LOW);
  }

  // -------- GAS DETECTION (Critical Alarm) --------
  if (gasValue > 800) {
    alarmActive = true;
    digitalWrite(RED_LED, HIGH);
    digitalWrite(BUZZER, HIGH);
    digitalWrite(RELAY, LOW);  // Emergency ventilation
    digitalWrite(GREEN_LED, LOW);
  }

  // -------- WATER LEVEL CONTROL --------
  if (waterValue == LOW) {  // Low water
    digitalWrite(WATER_PUMP, HIGH);
  } else {
    digitalWrite(WATER_PUMP, LOW);
  }

  // -------- NORMAL OPERATION --------
  if (!alarmActive) {
    digitalWrite(GREEN_LED, HIGH);
    digitalWrite(RED_LED, LOW);
    digitalWrite(BUZZER, LOW);
  }
}

void updateFirebase() {
  if (!firebaseConnected || !Firebase.ready()) {
    Serial.println("Firebase not ready");
    return;
  }

  FirebaseJson json;

  json.set("Temperature", temp);
  json.set("LDR", ldrValue);
  json.set("Gas", gasValue);
  json.set("Water", waterValue);
  json.set("WiFi", wifiConnected);
  json.set("Firebase", firebaseConnected);

  if (Firebase.RTDB.setJSON(&fbdo, "/Poultry", &json)) {
    Serial.println("✅ All data uploaded successfully");
  } else {
    Serial.print("❌ Firebase Error: ");
    Serial.println(fbdo.errorReason());
  }
}

void printStatus() {
  Serial.println("====== POULTRY STATUS ======");
  Serial.print("🌡️  Temperature: ");
  Serial.print(temp);
  Serial.println("°C");

  Serial.print("💡 LDR: ");
  Serial.println(ldrValue == LOW ? "DARK" : "LIGHT");

  Serial.print("☠️  Gas: ");
  Serial.println(gasValue);

  Serial.print("💧 Water: ");
  Serial.println(waterValue == LOW ? "LOW" : "OK");

  Serial.print("📶 WiFi: ");
  Serial.println(wifiConnected ? "OK" : "DISCONNECTED");
  Serial.print("🔥 Firebase: ");
  Serial.println(firebaseConnected ? "OK" : "DISCONNECTED");
  Serial.println("============================\n");
}

void checkConnections() {
  wifiConnected = WiFi.status() == WL_CONNECTED;

  if (!wifiConnected) {
    Serial.println("WiFi disconnected. Reconnecting...");
    connectToWiFi();
  }

  firebaseConnected = Firebase.ready();
}