CREATE TABLE `messages` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`request_id` char(36) NOT NULL,
	`sender_id` char(36) NOT NULL,
	`client_message_id` char(36) NOT NULL,
	`body` varchar(2000) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `messages_sender_client_unique` UNIQUE(`sender_id`,`client_message_id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`request_id` char(36) NOT NULL,
	`kind` enum('adoption_created','adoption_approved','adoption_rejected','message') NOT NULL,
	`audience` enum('admin','user') NOT NULL,
	`read_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_request_id_adoption_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `adoption_requests`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_sender_id_users_id_fk` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_request_id_adoption_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `adoption_requests`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `messages_request_id_idx` ON `messages` (`request_id`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read_at`);