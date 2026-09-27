CREATE TABLE `dog_images` (
	`id` char(36) NOT NULL,
	`dog_id` char(36) NOT NULL,
	`url` text NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`size` int unsigned NOT NULL,
	`type` varchar(100) NOT NULL,
	`position` smallint unsigned NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dog_images_id` PRIMARY KEY(`id`),
	CONSTRAINT `dog_images_dog_position_unique` UNIQUE(`dog_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `dogs` (
	`id` char(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`breed` varchar(100) NOT NULL,
	`age` decimal(3,1) NOT NULL,
	`gender` enum('male','female') NOT NULL,
	`weight` decimal(5,2) NOT NULL,
	`location` varchar(255),
	`description` text NOT NULL,
	`is_adopted` boolean NOT NULL DEFAULT false,
	`is_neutered` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dogs_id` PRIMARY KEY(`id`),
	CONSTRAINT `dogs_age_nonnegative` CHECK(`dogs`.`age` >= 0),
	CONSTRAINT `dogs_weight_positive` CHECK(`dogs`.`weight` > 0),
	CONSTRAINT `dogs_adopted_boolean` CHECK(`dogs`.`is_adopted` in (0, 1)),
	CONSTRAINT `dogs_neutered_boolean` CHECK(`dogs`.`is_neutered` in (0, 1))
);
--> statement-breakpoint
ALTER TABLE `dog_images` ADD CONSTRAINT `dog_images_dog_id_dogs_id_fk` FOREIGN KEY (`dog_id`) REFERENCES `dogs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `dogs_available_name_idx` ON `dogs` (`is_adopted`,`name`,`id`);