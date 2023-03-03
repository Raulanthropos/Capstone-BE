import mongoose from "mongoose";

const {Schema, model} = mongoose;

const dogSchema = new Schema(
    {
      name: { type: String, required: true },
      breed: { type: String, required: true },
      age: { type: Number, required: true },
      gender: { type: String, enum: ["male", "female"], required: true },
      images: [
        {
          fileName: { type: String, required: true },
          size: { type: Number, required: true },
          type: { type: String, required: true }
        }
      ],
      location: { type: String, required: true },
      description: { type: String, required: true },
      isAdopted: { type: Boolean, required: true, default: false },
      isNeutered: { type: Boolean, required: true, default: false }
    },
    { timestamps: true }
  );

  dogSchema.methods.toJSON = function () {
    const dogDoc = this;
    const dog = dogDoc.toObject();
    delete dog.createdAt;
    delete dog.updatedAt;
    delete dog.__v;
    return dog;
  };
  


  export default model("Dog", dogSchema);