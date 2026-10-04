CREATE USER order_app WITH PASSWORD 'order_dev_password';
CREATE USER payment_app WITH PASSWORD 'payment_dev_password';
CREATE USER worker_app WITH PASSWORD 'worker_dev_password';
CREATE DATABASE order_db OWNER order_app;
CREATE DATABASE payment_db OWNER payment_app;
CREATE DATABASE worker_db OWNER worker_app;
