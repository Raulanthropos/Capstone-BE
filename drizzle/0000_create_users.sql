CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`surname` varchar(100) NOT NULL,
	`age` int unsigned NOT NULL,
	`email` varchar(254) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`picture` text,
	`role` enum('admin','user') NOT NULL DEFAULT 'user',
	`description` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
