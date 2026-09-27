ALTER TABLE `adoption_requests` ADD `reviewed_by` char(36);--> statement-breakpoint
ALTER TABLE `adoption_requests` ADD `reviewed_at` timestamp;--> statement-breakpoint
ALTER TABLE `adoption_requests` ADD CONSTRAINT `adoption_requests_reviewed_by_users_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;