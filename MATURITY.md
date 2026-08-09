# Richardson Maturity Model Evaluation

This document evaluates the existing Task Management REST API against the **Richardson Maturity Model (RMM)**, which measures the design quality and REST compliance of web services.

## Project Overview

The project is an Express.js-based REST API designed to manage a list of tasks. The API implements CRUD (Create, Read, Update, Delete) operations using an in-memory storage array. It leverages ES Modules syntax and follows a clean MVC-like directory structure:
- **`server.js`**: Initializes the Express app, configures global middleware (logging, CORS, content-type validation, body parser), registers the task router, and sets up custom 404 and global error handlers.
- **`src/routes/taskRoutes.js`**: Registers standard HTTP verbs and maps URI routes to corresponding controller actions.
- **`src/controllers/taskController.js`**: Coordinates requests, implements data validation, invokes model actions, and returns appropriate status codes and JSON payloads.
- **`src/models/taskModel.js`**: Manages the task data structure in memory and provides utility methods for querying, creating, updating, and deleting tasks.
- **`src/middleware/`**: Implements reusable middlewares including logging, content-type checks, route-level ID validation, and error management.

---

## Evaluation Table

The table below outlines the RMM evaluation for the Task Management API.

| Level | Criterion | Satisfied? | Evidence |
| :--- | :--- | :--- | :--- |
| **Level 0** | **The Swamp of POX**<br>Uses HTTP as a transport protocol for remote calls. Typically a single URI with one verb (usually `POST`), where request payloads dictate actions. | **Yes (Moved Past)** | The API does **not** rely on a single endpoint or a single transport method. It exposes discrete resource URLs (`/tasks` and `/tasks/:id`) and routes requests based on HTTP verbs. |
| **Level 1** | **Resources**<br>Introduces individual resource URIs. Addresses specific entities rather than passing IDs or action verbs inside the request payload to a single endpoint. | **Yes** | The API distinguishes between the collection resource (`/tasks`) and individual item resources (`/tasks/:id`) using clean, noun-based, resource-oriented URIs. |
| **Level 2** | **HTTP Verbs**<br>Utilizes standard HTTP methods semantically (e.g., `GET` for safe reads, `POST` for creates, `PUT` for updates, `DELETE` for deletes) and returns accurate HTTP status codes. | **Yes** | The API maps operations to proper verbs: `GET` to read, `POST` to create, `PUT` to update, and `DELETE` to delete. It utilizes status codes semantically: `200` (OK), `201` (Created), `400` (Bad Request), `404` (Not Found), and `500` (Internal Server Error). |
| **Level 3** | **Hypermedia Controls (HATEOAS)**<br>Responses are self-describing and contain links (`_links`) pointing to related actions, allowing clients to navigate the API dynamically. | **No** | API responses only return resource data payloads (e.g., arrays or task objects). They do **not** contain hypermedia links to guide client transitions or actions. |

---

## Level-by-Level Analysis

### Level 0: The Swamp of POX (Plain Old XML/JSON)
* **Goal**: Determine whether the API uses a single generic endpoint or resource-based endpoints.
* **Evaluation**: **Satisfied (API has matured beyond Level 0)**.
* **Evidence**:
  A Level 0 API uses a single endpoint (e.g., `/api` or `/service`) to process all requests. If the API were at Level 0, clients would send all actions (like "getTask", "createTask", "deleteTask") as `POST` payloads to that single URI. 
  In this project, `server.js` and `taskRoutes.js` demonstrate that different URIs are mapped to distinct actions:
  - Routing base configured at `/tasks` in `server.js` (line 31):
    ```javascript
    app.use('/tasks', taskRoutes);
    ```
  - Specific endpoints in `src/routes/taskRoutes.js`:
    ```javascript
    router.get('/', taskController.getAllTasks);
    router.post('/', taskController.createTask);
    router.put('/:id', validateTaskId, taskController.updateTask);
    router.delete('/:id', validateTaskId, taskController.deleteTask);
    ```
  This proves the API has transitioned past the single-endpoint paradigm of Level 0.

### Level 1: Resources
* **Goal**: Verify if the API uses resource-oriented URLs.
* **Evaluation**: **Satisfied**.
* **Evidence**:
  Level 1 introduces resource addressing using specific URIs for distinct resources instead of communicating with a single endpoint. The API utilizes noun-based, hierarchical URIs:
  - `/tasks` represents the collection of tasks.
  - `/tasks/:id` represents a specific task resource identified by its unique ID (e.g., `/tasks/1`, `/tasks/2`).
  
  This matches the resource-oriented design principle of Level 1. In `taskController.js`, parameters are extracted from the URI path parameter (`req.params.id`) to operate on individual resources:
  ```javascript
  const { id } = req.params;
  const updatedTask = taskModel.update(id, { title, description, completed });
  ```

### Level 2: HTTP Verbs
* **Goal**: Verify correct HTTP methods and status codes are used semantically across all endpoints.
* **Evaluation**: **Satisfied**.
* **Evidence**:
  The API correctly uses HTTP verbs and status codes for its operations:
  
  1. **HTTP Verbs Mapping**:
     - **`GET /tasks`**: Used for retrieving the list of tasks. This is a safe and idempotent read operation.
     - **`POST /tasks`**: Used for creating a new task. This is a non-idempotent write operation.
     - **`PUT /tasks/:id`**: Used for updating an existing task. This is an idempotent update/replace operation.
     - **`DELETE /tasks/:id`**: Used for deleting a task. This is an idempotent delete operation.
     
  2. **HTTP Status Codes Mapping**:
     - **`200 OK`**:
       - Returned by `GET /tasks` upon successful retrieval of the task array:
         ```javascript
         res.status(200).json(tasks);
         ```
       - Returned by `PUT /tasks/:id` upon successful task update:
         ```javascript
         res.status(200).json(updatedTask);
         ```
       - Returned by `DELETE /tasks/:id` upon successful deletion:
         ```javascript
         res.status(200).json({ message: "Task deleted successfully" });
         ```
     - **`201 Created`**:
       - Returned by `POST /tasks` upon successful resource creation:
         ```javascript
         res.status(201).json(newTask);
         ```
     - **`400 Bad Request`**:
       - Returned by `validateContentType` middleware if a `POST` or `PUT` request lacks `Content-Type: application/json`:
         ```javascript
         return res.status(400).json({ error: "Content-Type must be application/json" });
         ```
       - Returned by `POST /tasks` if the `title` is missing or invalid:
         ```javascript
         return res.status(400).json({ error: "Title is required and must be a non-empty string" });
         ```
       - Returned by `PUT /tasks/:id` if the user-supplied update `title` is empty or invalid:
         ```javascript
         return res.status(400).json({ error: "Title must be a non-empty string" });
         ```
     - **`404 Not Found`**:
       - Returned by `validateTaskId` middleware on `PUT` / `DELETE` if the task ID does not exist in memory:
         ```javascript
         return res.status(404).json({ error: "Task not found" });
         ```
       - Returned by the fallback middleware in `server.js` if the client requests an undefined route (e.g. `/invalid`):
         ```javascript
         res.status(404).json({ error: "Route not found" });
         ```
     - **`500 Internal Server Error`**:
       - Returned by the centralized error handler in `errorHandler.js` if an unexpected server error occurs:
         ```javascript
         res.status(statusCode).json({ error: statusCode === 500 ? "Something went wrong" : err.message });
         ```
  
  Since all HTTP verbs and status codes align with standard RESTful conventions, the project fully satisfies Level 2 of the model.

### Level 3: Hypermedia Controls (HATEOAS)
* **Goal**: Understand hypermedia controls and design an example response.
* **Evaluation**: **Not Satisfied** (Awareness only; implementation is not required by the assignment).
* **Evidence**:
  The API currently returns JSON representations containing only the entity's data fields (e.g., `id`, `title`, `description`, `completed`, `createdAt`). It does not embed hyperlinks (`_links` or navigation controls) pointing to related actions, meaning clients must hardcode URL construction rather than navigating dynamically.

---

## HATEOAS Example (Level 3 Compliance)

If the Task Management API were to be upgraded to Level 3, a response for a single task would include hypermedia controls (`_links`) enabling clients to navigate the resource lifecycle dynamically:

```json
{
  "id": "1",
  "title": "Setup Node.js Server",
  "description": "Initialize project, install dependencies and setup express",
  "completed": true,
  "createdAt": "2026-08-03T15:13:00.000Z",
  "_links": {
    "self": {
      "href": "/tasks/1",
      "method": "GET",
      "title": "Retrieve this task"
    },
    "update": {
      "href": "/tasks/1",
      "method": "PUT",
      "title": "Update this task"
    },
    "delete": {
      "href": "/tasks/1",
      "method": "DELETE",
      "title": "Delete this task"
    },
    "collection": {
      "href": "/tasks",
      "method": "GET",
      "title": "List all tasks"
    }
  }
}
```

---

## Why Most Production APIs Stop at Level 2

While Level 3 (HATEOAS) represents the theoretical pinnacle of REST design, the vast majority of real-world production APIs choose to halt compliance at Level 2. The primary reasons for this industry standard include:

1. **Client Coupling & Hardcoding**: In practice, client-side developers write frontend code or scripts designed for a specific page layout and flow. They tend to hardcode URIs (like `/tasks`) or use API client libraries generated from schemas (e.g., OpenAPI/Swagger) rather than dynamically exploring hypermedia links at runtime. As a result, the benefits of dynamic discoverability are rarely realized.
2. **Implementation Overhead & Payload Bloat**: Adding `_links` to every API response requires extra logic in serializers, database/service layer integration, and increases payload sizes significantly (especially for large collection lists). This results in additional backend processing and increased network bandwidth usage without yielding substantial practical value.
3. **Tooling and Specifications Standard**: Standard tooling, such as OpenAPI/Swagger, has become the dominant method for defining and documenting REST APIs. These tools describe endpoints, request structures, and response schemas statically at Level 2. Because these formats are widely supported by code generation tools, they lessen the need for runtime self-discovery.
4. **Caching Complexity**: Managing hypermedia links in responses can make HTTP caching more complex, as links might depend on context (e.g., user permissions, state changes) which could render cached responses stale or incorrect for other contexts.
