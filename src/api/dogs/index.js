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
import { adminOnlyMiddleware } from "../../lib/auth/adminOnly.js";

const dogsRouter = express.Router();

// cloudinary.config({
//     cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//     api_key: process.env.CLOUDINARY_API_KEY,
//     api_secret: process.env.CLOUDINARY_API_SECRET,
//     secure: true
//   });

//   const storage = new CloudinaryStorage({
//     cloudinary: cloudinary
//   });
  
//   const upload = multer({ storage: storage });

//Create a cloudinary configuration object
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

//Create a multer storage object
// const storage = new CloudinaryStorage({
//   cloudinary: cloudinary,
//   params: {
//     folder: "public/images",
//   },
// });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images')
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now())
  }
})
//Create a multer object that will upload to Cloudinary
const upload = multer({ dest: 'public/images' });

//Create a router to post a new dog
dogsRouter.post("/", upload.single("image"), async (req, res, next) => {
  try {
    const newDog = new DogsModel({
      name: req.body.name,
      breed: req.body.breed,
      age: req.body.age,
      gender: req.body.gender,
      location: req.body.location,
      description: req.body.description,
      isAdopted: req.body.isAdopted,
      isNeutered: req.body.isNeutered,
    });

    if (req.file) {
      const base64Data = fs.readFileSync(req.file.path, { encoding: "base64" });
      const publicId = uniqid();
      const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${base64Data}`, { public_id: publicId, folder: "public/images" });
      const imageMetadata = {
        fileName: result.public_id,
        size: result.bytes,
        type: result.format,
      };
      newDog.images = [imageMetadata];
    }

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

// dogsRouter.get("/", async (req, res, next) => {
//     try {
//       const mongoQuery = q2m(req.query)
//       const total = await DogsModel.countDocuments(mongoQuery.criteria)
//       const dogs = await DogsModel.find(mongoQuery.criteria, mongoQuery.options.fields)
//       .limit(mongoQuery.options.limit) // No matter the order of usage of these 3 options, Mongo will ALWAYS go with SORT, then SKIP, then LIMIT
//       .skip(mongoQuery.options.skip)
//       .sort(mongoQuery.options.sort)
//       if (dogs) {
//         res.send(dogs);
//       } else {
//         next(createHttpError(404, `dogs not found`));
//       }
//     } catch (error) {
//       next(error);
//     }
//   });

dogsRouter.get("/", async (req, res, next) => {
  try {
    const mongoQuery = q2m(req.query);
    const total = await DogsModel.countDocuments(mongoQuery.criteria);
    let sortOption = {};
    if (req.query.sort) {
      sortOption[req.query.sort] = req.query.order === "desc" ? -1 : 1;
    } else {
      sortOption = { age: req.query.order === "desc" ? -1 : 1 };
    }
    const dogs = await DogsModel.find(mongoQuery.criteria, mongoQuery.options.fields)
      .limit(mongoQuery.options.limit)
      .skip(mongoQuery.options.skip)
      .sort(sortOption);
    if (dogs) {
      res.send(dogs);
    } else {
      next(createHttpError(404, `Dogs not found`));
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
        const message = `Successfully deleted ${deletedDog.name}`;
        res.status(200).send({ message });
      } else {
        next(createHttpError(404, 'Dog not found'));
      }
    } catch (error) {
      next(error);
    }
  });

dogsRouter.post('/:id/upload', upload.single('image'), async (req, res) => {
  try {
    const image = req.file;
    const imagePath = image.path;
    const publicId = uniqid();
    const uploadResult = await cloudinary.uploader.upload(imagePath, { public_id: publicId, folder: 'public/images' });

    const imageMetadata = {
      fileName: uploadResult.public_id,
      size: uploadResult.bytes,
      type: uploadResult.format,
      url: uploadResult.secure_url // add the URL of the uploaded image here
    };

    // Add the uploaded image metadata to the images array in the Dog model
    const dog = await DogsModel.findById(req.params.id);
    dog.images.push(imageMetadata);
    await dog.save();
    res.json(dog);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to upload image' });
  }
});
  
export default dogsRouter;