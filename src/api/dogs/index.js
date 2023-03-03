import mongoose from "mongoose";
import express from "express";
import listEndpoints from "express-list-endpoints";
import q2m from "query-to-mongo";
import DogsModel from "./model.js"
import { JWTAuthMiddleware } from "../../lib/auth/jwtAuth.js";
import createHttpError from "http-errors";
import { createAccessToken } from "../../lib/auth/tools.js";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { v2 as cloudinary } from "cloudinary";
import http from "http";
import base64 from "base-64";
import uniqid from "uniqid";

const dogsRouter = express.Router();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
  
  const storage = new CloudinaryStorage({
    cloudinary: cloudinary
  });
  
  const upload = multer({ storage: storage });

dogsRouter.get("/", async (req, res, next) => {
    try {
      const dogs = await DogsModel.find();
      if (dogs) {
        res.send(dogs);
      } else {
        next(createHttpError(404, `dogs not found`));
      }
    } catch (error) {
      next(error);
    }
  });

  dogsRouter.get('/:id', async (req, res, next) => {
    try {
      const dog = await DogsModel.findById(req.params.id);
      if (dog) {
        res.send(dog);
      } else {
        next(createHttpError(404, 'Dog not found'));
      }
    } catch (error) {
      next(error);
    }
  });
  

    dogsRouter.post("/", async (req, res, next) => {
    try {
      const newDog = new DogsModel(req.body);
      const checkDogName = await DogsModel.findOne({
        name: newDog.name,
      });
      if (checkDogName) {
        next(createHttpError(400, "dogname already in use!"));
      } else {
        const { _id } = await newDog.save();
        res.status(201).send({ _id });
        console.log(`dog with id ${_id} successfully created!`);
      }
    } catch (error) {
      next(error);
    }
  });

  dogsRouter.put('/:id', async (req, res, next) => {
    try {
      const updatedDog = await DogsModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (updatedDog) {
        res.send(updatedDog);
      } else {
        next(createHttpError(404, 'Dog not found'));
      }
    } catch (error) {
      next(error);
    }
  });

  dogsRouter.delete('/:id', async (req, res, next) => {
    try {
      const deletedDog = await DogsModel.findByIdAndDelete(req.params.id);
      if (deletedDog) {
        res.send(deletedDog);
      } else {
        next(createHttpError(404, 'Dog not found'));
      }
    } catch (error) {
      next(error);
    }
  });
    

dogsRouter.post('/:id/upload', async (req, res) => {
  try {
    const imageUrls = req.body.imageUrls;
    const uploadResults = await Promise.all(
      imageUrls.map(async (imageUrl) => {
        const response = await new Promise((resolve, reject) => {
          http.get(imageUrl, (response) => {
            if (response.statusCode < 200 || response.statusCode > 299) {
              reject(new Error(`Failed to load image, status code: ${response.statusCode}`));
            }
            const data = [];
            response.on('data', (chunk) => {
              data.push(chunk);
            });
            response.on('end', () => {
              const imageData = Buffer.concat(data);
              resolve(imageData);
            });
            response.on('error', (error) => {
              reject(error);
            });
          });
        });
        const base64Data = response.toString('base64');
        const publicId = uniqid();
        const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${base64Data}`, { public_id: publicId, folder: 'public/images' });
        return result;
      })
    );  
    const imageMetadata = uploadResults.map((result) => {
        return {
          fileName: result.public_id,
          size: result.bytes,
          type: result.format
        };
      });
      
      // Add the uploaded image metadata to the images array in the Dog model
      const dog = await DogsModel.findById(req.params.id);
      dog.images.push(...imageMetadata);
      await dog.save();
      res.json(dog);
      
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to upload image' });
  }
});

  
export default dogsRouter;