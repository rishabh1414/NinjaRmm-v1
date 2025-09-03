# NinjaRMM Node.js API Documentation

Base URL: https://ninjarmmv1.securebusinessautomation.com

⸻

Authentication

All endpoints use the stored Bearer Token (handled by the backend). No need to include it manually in your requests.

⸻

Endpoints

1. Get Access Token

Retrieve the current access token stored in MongoDB.

curl -X GET \
  "https://ninjarmmv1.securebusinessautomation.com/api/access-token"

Response:

{
  "access_token": "eyJhbGciOiJI...",
  "expires_in": 3600
}


⸻

2. Create Ticket

Create a new ticket in NinjaOne.

curl -X POST \
  "https://ninjarmmv1.securebusinessautomation.com/api/tickets" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": 22,
    "ticketFormId": 1001,
    "subject": "API Test Ticket",
    "description": {
      "body": "Ticket created via API"
    },
    "status": 1000
  }'

Response:

{
  "ticketId": 1234,
  "status": "NEW"
}


⸻

3. Get Ticket by ID

Fetch details of a single ticket.

curl -X GET \
  "https://ninjarmmv1.securebusinessautomation.com/api/tickets/1003" \
  -H "Accept: application/json"

Response:

{
  "ticket": {
    "number": 1003,
    "subject": "Printer not working",
    "status": "OPEN",
    "customer": {
      "fullname": "John Doe"
    }
  }
}


⸻

4. Update Ticket Status

Update the status of a ticket by ID.

curl -X PUT \
  "https://ninjarmmv1.securebusinessautomation.com/api/tickets/1004" \
  -H "Content-Type: application/json" \
  -d '{
    "status": 2000
  }'

Response:

{
  "ticketId": 1004,
  "status": "OPEN"
}


⸻

5. Get All Organizations

Retrieve a list of all organizations.

curl -X GET \
  "https://ninjarmmv1.securebusinessautomation.com/api/organizations" \
  -H "Accept: application/json"

Response:

[
  {
    "organizationId": 22,
    "name": "TESTING - Rishabh"
  },
  {
    "organizationId": 23,
    "name": "ABC Corp"
  }
]


⸻

6. Get Organization by Name

Search organization by its display name.

curl -X GET \
  "https://ninjarmmv1.securebusinessautomation.com/api/organizations/search?name=TESTING%20-%20Rishabh" \
  -H "Accept: application/json"

Response:

{
  "organizationId": 22,
  "name": "TESTING - Rishabh"
}


⸻

Ticket Status Codes
	•	1000 → NEW
	•	2000 → OPEN
	•	3000 → WAITING
	•	4000 → PAUSED
	•	5000 → RESOLVED
	•	6000 → CLOSED

⸻

✅ Use these statusId values when updating ticket status.
