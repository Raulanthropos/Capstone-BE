CREATE TABLE `adoption_requests` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`dog_id` char(36) NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `adoption_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `adoption_requests_user_dog_unique` UNIQUE(`user_id`,`dog_id`)
);
--> statement-breakpoint
ALTER TABLE `adoption_requests` ADD CONSTRAINT `adoption_requests_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `adoption_requests` ADD CONSTRAINT `adoption_requests_dog_id_dogs_id_fk` FOREIGN KEY (`dog_id`) REFERENCES `dogs`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `adoption_requests_user_created_idx` ON `adoption_requests` (`user_id`,`created_at`,`id`);