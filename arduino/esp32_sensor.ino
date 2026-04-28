#include <WiFi.h>
#include <HTTPClient.h>
#include "DHT.h"

// Replace with your network credentials
const char* ssid = "REPLACE_WITH_YOUR_SSID";
const char* password = "REPLACE_WITH_YOUR_PASSWORD";

const char* serverURL = "https://ai-sensor.onrender.com";

// DHT11 setup
#define DHTPIN 4
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while(WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi connected!");
  
  dht.begin();
}

void loop() {
  if(WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverURL);
    http.addHeader("Content-Type", "application/json");

    // Read real sensors
    float t = dht.readTemperature();
    float h = dht.readHumidity();

    // Check for read errors
    if (isnan(t) || isnan(h)) {
      Serial.println("Failed to read from DHT sensor!");
      return;
    }

    String jsonPayload = "{\"temp\": " + String(t) + ", \"humidity\": " + String(h) + ", \"source\": \"real\"}";
    
    int httpResponseCode = http.POST(jsonPayload);
    
    if(httpResponseCode > 0) {
      Serial.print("HTTP Response code: ");
      Serial.println(httpResponseCode);
    } else {
      Serial.print("Error code: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  }
  
  delay(5000); // Send data every 5 seconds
}
