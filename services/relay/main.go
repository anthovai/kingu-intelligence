// Kingu Intelligence — relay service (Go)
// Phase 2 target: replaces the Node-based mobile pairing relay in cloud/.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8787"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"service": "kingu-relay",
			"status":  "ok",
		})
	})

	log.Printf("kingu-relay listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
