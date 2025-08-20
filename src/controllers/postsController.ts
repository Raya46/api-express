import { Response } from "express";
import { supabase } from "../config/supabase";
import { AuthenticatedRequest } from "../middleware/auth";

export class PostsController {
  // Get all posts
  static async getAllPosts(req: AuthenticatedRequest, res: Response) {
    try {
      const { data: posts, error } = await supabase
        .from("posts")
        .select(
          ` 
           *, 
           users ( 
             id, 
             email, 
             full_name, 
             avatar_url 
           ) 
         `
        )
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({ posts });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Get single post
  static async getPost(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;

      const { data: post, error } = await supabase
        .from("posts")
        .select(
          ` 
           *, 
           users ( 
             id, 
             email, 
             full_name, 
             avatar_url 
           ) 
         `
        )
        .eq("id", id)
        .single();

      if (error) {
        return res.status(404).json({ error: "Post not found" });
      }

      return res.json({ post });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Create new post
  static async createPost(req: AuthenticatedRequest, res: Response) {
    try {
      const { title, content } = req.body;
      const userId = req.user?.id;

      if (!title || !content) {
        return res.status(400).json({
          error: "Title and content are required",
        });
      }

      const { data: post, error } = await supabase
        .from("posts")
        .insert({
          title,
          content,
          user_id: userId!,
        })
        .select(
          ` 
           *, 
           users ( 
             id, 
             email, 
             full_name, 
             avatar_url 
           ) 
         `
        )
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.status(201).json({
        message: "Post created successfully",
        post,
      });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Update post
  static async updatePost(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { title, content } = req.body;
      const userId = req.user?.id;

      // Check if post exists and belongs to user
      const { data: existingPost, error: fetchError } = await supabase
        .from("posts")
        .select("user_id")
        .eq("id", id)
        .single();

      if (fetchError || !existingPost) {
        return res.status(404).json({ error: "Post not found" });
      }

      if (existingPost.user_id !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to update this post" });
      }

      const { data: post, error } = await supabase
        .from("posts")
        .update({
          title,
          content,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select(
          ` 
           *, 
           users ( 
             id, 
             email, 
             full_name, 
             avatar_url 
           ) 
         `
        )
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({
        message: "Post updated successfully",
        post,
      });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Delete post
  static async deletePost(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      // Check if post exists and belongs to user
      const { data: existingPost, error: fetchError } = await supabase
        .from("posts")
        .select("user_id")
        .eq("id", id)
        .single();

      if (fetchError || !existingPost) {
        return res.status(404).json({ error: "Post not found" });
      }

      if (existingPost.user_id !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to delete this post" });
      }

      const { error } = await supabase.from("posts").delete().eq("id", id);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({ message: "Post deleted successfully" });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Get user's posts
  static async getUserPosts(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;

      const { data: posts, error } = await supabase
        .from("posts")
        .select(
          ` 
           *, 
           users ( 
             id, 
             email, 
             full_name, 
             avatar_url 
           ) 
         `
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({ posts });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
