# RCM Onboarding Guide

Welcome to the **RCM (Revenue Cycle Management)** documentation. This guide covers the initial steps and essential knowledge for getting up to speed with the RCM integration.

## Overview

The RCM system acts as the central hub for handling billing, invoicing, and patient lifecycle management within the CRM alternate project. It focuses on ensuring data consistency between external health APIs, the local database, and billing engines.

## Prerequisites

Before starting, ensure you have:
- Access to the CRM Alternate repository.
- Node.js (v18+) and Python (v3.10+) installed.
- Appropriate API credentials (FastAPI integration).
- Running local PostgreSQL/Redis instances (if applicable).

## Getting Started

1. **Clone and Install:**
   Navigate to the project root and install the necessary dependencies for both the frontend and backend services.

2. **Environment Variables:**
   Copy the `.env.example` file to `.env` and configure your local settings, including database connection strings and FastAPI endpoints.

3. **Running the Services:**
   Start the FastAPI backend server first, followed by the React/Next.js frontend.

## Architecture Guidelines

- **Decoupled Architecture:** Keep the frontend state logic separated from the API calls.
- **Error Handling:** Ensure that all HTTP exceptions from the FastAPI backend are appropriately caught and displayed in the frontend.
- **Data Validation:** Use Pydantic models extensively in the backend to validate incoming payloads.

## Next Steps

Review the [API Reference](api-reference.md) to understand the available endpoints and how to authenticate requests.
