# Capstone-BE

## Project Overview
This project is a dog fostering service website that allows dog shelters to provide details about dogs up for adoption, and users to browse and adopt dogs. The website includes three types of users: admins, dog shelters, and users interested in adopting dogs.

## Technologies Used
This backend of the project was built using the following technologies:

* NodeJS: a JavaScript runtime built on Chrome's V8 JavaScript engine.
* ExpressJS: a web application framework for NodeJS.
* MongoDB: a document-based NoSQL database.

## API Endpoints
The backend API includes the following endpoints:

* POST /api/users/login: This endpoint is used for user authentication. Users can log in using their email and password.
* POST /api/shelters/login: This endpoint is used for shelter authentication. Shelters can log in using their email and password.
* POST /api/admins/login: This endpoint is used for admin authentication. Admins can log in using their email and password.
* GET /api/shelters: This endpoint returns a list of all dog shelters in the database.
* GET /api/users: This endpoint returns a list of all users in the database.
Additional endpoints will be added to the backend API for adding, editing and deleting dogs by dog shelters, and for users to filter dogs based on different criteria.

## API Documentation
The API documentation is available through Postman, and includes information about all endpoints, input and output formats, and any necessary authentication or authorization requirements.

## Database Schema
The database schema will be provided later, as the code is developed.

## Testing
Testing will be done using Jest, a popular testing framework for NodeJS. Instructions for how to run the tests will be provided in the future.

## Contributors
This project is developed by Ioannis Psychias and any other team members or collaborators.

## License
The project is licensed under [Insert License Here].
